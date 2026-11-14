'use server';

import { revalidatePath } from 'next/cache';
import { desc, eq, sql } from 'drizzle-orm';
import { audienceWhere, campaignRecipients, campaigns, loadGroups, templates } from '@lbc/db';
import { Forbidden, assertRole, db, requireCtx, type Ctx, audit } from '@/lib/session';
import { estimateCost, RATE_PAISE_X100 } from '@/lib/cost';
import { cancelCampaignFor, createCampaignFor, isLive, previewAudienceFor, queueCampaignFor, type AudiencePreview, type CampaignInput } from '@/lib/core/campaigns';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

async function guard(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) {
    if (e instanceof Forbidden) return { error: 'Your role cannot do this. Ask the workspace owner.' };
    throw e;
  }
  return { ctx };
}

export interface CampaignRow {
  id: string; name: string; status: string; templateName: string | null; category: string | null; scheduledAt: string | null; repeat: string; estCostPaise: number;
  counts: Record<string, number>; createdAt: string; groupNames: string[];
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const rows = await tx.select({ c: campaigns, tn: templates.name, tc: templates.category }).from(campaigns).leftJoin(templates, eq(templates.id, campaigns.templateId)).orderBy(desc(campaigns.createdAt)).limit(200);
    const gn = await tx.execute(sql`select id, name from contact_groups`);
    const names = new Map((gn as unknown as { id: string; name: string }[]).map((g) => [g.id, g.name]));
    return rows.map(({ c, tn, tc }) => ({
      id: c.id, name: c.name, status: c.status, templateName: tn, category: tc, scheduledAt: c.scheduledAt?.toISOString() ?? null, repeat: c.repeat, estCostPaise: c.estCostPaise,
      counts: c.counts as Record<string, number>, createdAt: c.createdAt.toISOString(), groupNames: c.groupIds.map((i) => names.get(i) ?? 'Deleted group'),
    }));
  });
}

export type { AudiencePreview };

/** Who would receive this campaign. Only people who agreed (consent = allowed) are sendable. Nobody is ever messaged without a record. */
export async function previewAudience(groupIds: string[], category: string): Promise<AudiencePreview> {
  return previewAudienceFor(await requireCtx(), groupIds, category);
}

export type { CampaignInput };

export async function createCampaign(raw: CampaignInput): Promise<Result<{ id: string; status: string }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const r = await createCampaignFor(g.ctx, raw);
  if (!r.ok) return r;
  revalidatePath('/campaigns');
  return { ok: true, data: { id: r.data.id, status: r.data.status } };
}

/** Deterministic spread so a test run looks like a real one without pretending to be one. */
function simulate(i: number): 'delivered' | 'read' | 'replied' | 'failed' {
  const h = (i * 2654435761) % 100;
  if (h < 5) return 'failed'; if (h < 12) return 'replied'; if (h < 55) return 'read'; return 'delivered';
}

/** True when this workspace has a valid WhatsApp connection with a number, so sends go to the real queue. */
export async function connectionState(): Promise<{ live: boolean }> {
  return { live: await isLive(await requireCtx()) };
}

async function queueForWorker(id: string): Promise<Result<{ sent: number; testMode: false }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const r = await queueCampaignFor(g.ctx, id);
  if (r.ok) revalidatePath('/campaigns');
  return r;
}

/** TEST MODE: expands the audience into recipients and marks simulated results. Nothing is sent to WhatsApp until a number is connected. */
export async function sendCampaign(id: string): Promise<Result<{ sent: number; testMode: boolean }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  if ((await connectionState()).live) return queueForWorker(id);
  return db(g.ctx, async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
    if (!c) return fail('Campaign not found.');
    if (!['draft', 'scheduled', 'paused'].includes(c.status)) return fail('This campaign has already been sent.');
    const [t] = c.templateId ? await tx.select().from(templates).where(eq(templates.id, c.templateId)) : [];
    if (!t || t.status !== 'approved') return fail('The message format is no longer approved.');
    const groups = await loadGroups(tx, g.ctx.tenantId, c.groupIds);
    const rows = await tx.execute(sql`select c.id, c.phone_e164, c.name, c.consent_status from contacts c where c.tenant_id = ${g.ctx.tenantId}::uuid and ${audienceWhere(g.ctx.tenantId, groups)} order by c.id`);
    const all = rows as unknown as { id: string; phone_e164: string; name: string | null; consent_status: string }[];
    const sendable = all.filter((r) => r.consent_status === 'allowed');
    const skipped = all.filter((r) => r.consent_status !== 'allowed');
    const est = estimateCost(sendable.length, t.category);
    if (c.spendCapPaise !== null && est.totalPaise > c.spendCapPaise) return fail('The cost is now above your spend cap. Nothing was sent.');
    const now = new Date();
    const recs = sendable.map((r, i) => { const s = simulate(i); return { tenantId: g.ctx.tenantId, campaignId: id, contactId: r.id, phoneE164: r.phone_e164, name: r.name, state: s, reason: s === 'failed' ? 'Simulated failure (test mode)' : null, sentAt: now }; });
    const skip = skipped.map((r) => ({ tenantId: g.ctx.tenantId, campaignId: id, contactId: r.id, phoneE164: r.phone_e164, name: r.name, state: 'skipped', reason: r.consent_status === 'stopped' ? 'Opted out' : 'No permission on record' }));
    for (let i = 0; i < recs.length; i += 500) await tx.insert(campaignRecipients).values(recs.slice(i, i + 500));
    for (let i = 0; i < skip.length; i += 500) await tx.insert(campaignRecipients).values(skip.slice(i, i + 500));
    const n = (s: string) => recs.filter((r) => r.state === s).length;
    const counts = { audience: sendable.length, sent: sendable.length, delivered: sendable.length - n('failed'), read: n('read') + n('replied'), replied: n('replied'), failed: n('failed'), skipped: skip.length, optedOut: skipped.filter((r) => r.consent_status === 'stopped').length, testMode: 1 };
    const nextAt = c.repeat === 'none' ? null : new Date((c.scheduledAt ?? now).getTime() + ({ daily: 1, weekly: 7, monthly: 30 }[c.repeat as 'daily'] ?? 1) * 86_400_000);
    await tx.update(campaigns).set({ status: 'completed', startedAt: now, completedAt: now, counts, estCostPaise: est.totalPaise, ...(nextAt ? {} : {}) }).where(eq(campaigns.id, id));
    await audit(tx, 'campaign.sent_test', 'campaign', id, counts);
    revalidatePath('/campaigns');
    return { ok: true as const, data: { sent: sendable.length, testMode: true as const } };
  });
}

export async function cancelCampaign(id: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const r = await cancelCampaignFor(g.ctx, id);
  if (r.ok) revalidatePath('/campaigns');
  return r;
}

export interface CampaignReport { c: CampaignRow; failed: { name: string | null; phone: string; reason: string | null }[]; skipped: { name: string | null; phone: string; reason: string | null }[] }
export async function campaignReport(id: string): Promise<CampaignReport | null> {
  const ctx = await requireCtx();
  const all = await listCampaigns();
  const c = all.find((x) => x.id === id);
  if (!c) return null;
  return db(ctx, async (tx) => {
    const rs = await tx.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id)).limit(2000);
    const pick = (s: string) => rs.filter((r) => r.state === s).slice(0, 100).map((r) => ({ name: r.name, phone: r.phoneE164, reason: r.reason }));
    return { c, failed: pick('failed'), skipped: pick('skipped') };
  });
}

export async function rateInfo() { return { marketing: RATE_PAISE_X100.marketing, utility: RATE_PAISE_X100.utility }; }

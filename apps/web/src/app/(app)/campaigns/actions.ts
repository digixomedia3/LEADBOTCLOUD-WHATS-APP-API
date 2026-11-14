'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { campaignRecipients, campaigns, templates } from '@lbc/db';
import { Forbidden, assertRole, db, requireCtx, type Ctx, audit } from '@/lib/session';
import { estimateCost, RATE_PAISE_X100 } from '@/lib/cost';
import { variablesIn } from '@lbc/shared';

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

export interface AudiencePreview { total: number; sendable: number; optedOut: number; noRecord: number; cost: ReturnType<typeof estimateCost> }

/** Who would receive this campaign. Only people who agreed (consent = allowed) are sendable. Nobody is ever messaged without a record. */
export async function previewAudience(groupIds: string[], category: string): Promise<AudiencePreview> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const ids = z.array(z.string().uuid()).parse(groupIds);
    if (!ids.length) return { total: 0, sendable: 0, optedOut: 0, noRecord: 0, cost: estimateCost(0, category) };
    const r = await tx.execute(sql`
      select count(distinct c.id)::int as total,
             count(distinct c.id) filter (where c.consent_status = 'allowed')::int as sendable,
             count(distinct c.id) filter (where c.consent_status = 'stopped')::int as opted_out,
             count(distinct c.id) filter (where c.consent_status = 'unknown')::int as no_record
      from contacts c join contact_group_members m on m.contact_id = c.id
      where m.group_id = any(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]`)})`);
    const x = (r as unknown as { total: number; sendable: number; opted_out: number; no_record: number }[])[0]!;
    return { total: x.total, sendable: x.sendable, optedOut: x.opted_out, noRecord: x.no_record, cost: estimateCost(x.sendable, category) };
  });
}

const input = z.object({
  name: z.string().trim().min(2, 'Give the campaign a name.').max(120),
  templateId: z.string().uuid('Choose an approved message format.'),
  groupIds: z.array(z.string().uuid()).min(1, 'Choose at least one group.').max(50),
  when: z.enum(['now', 'later']),
  scheduledAt: z.string().optional(),
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
  spendCapRupees: z.number().min(0).max(10_000_000).optional(),
  /** One entry per {{n}} in the body: '@name', '@fullname', '@phone' or fixed text. */
  varMap: z.array(z.string().trim().min(1, 'Fill in every variable.').max(200)).max(20).default([]),
  /** For a format with a Copy code button: the code every recipient gets (1 to 15 letters, numbers, - or _). */
  offerCode: z.string().trim().regex(/^[A-Za-z0-9_-]{1,15}$/, 'The offer code can be 1 to 15 letters or numbers.').optional(),
  /** For a format with a countdown: when the offer ends (ISO time). */
  offerEndsAt: z.string().optional(),
});
export type CampaignInput = z.input<typeof input>;

export async function createCampaign(raw: CampaignInput): Promise<Result<{ id: string; status: string }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const p = input.safeParse(raw);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  const d = p.data;
  let when: Date | null = null;
  if (d.when === 'later') {
    when = d.scheduledAt ? new Date(d.scheduledAt) : null;
    if (!when || Number.isNaN(when.getTime())) return fail('Choose a date and time.');
    if (when.getTime() < Date.now() + 5 * 60_000) return fail('Pick a time at least 5 minutes from now.');
    if (when.getTime() > Date.now() + 90 * 86_400_000) return fail('You can schedule up to 90 days ahead.');
  }
  return db(g.ctx, async (tx) => {
    const [t] = await tx.select().from(templates).where(eq(templates.id, d.templateId));
    if (!t) return fail('That message format was not found.');
    if (t.status !== 'approved') return fail('Only approved message formats can be sent. Get this one approved first.');
    const groups = await tx.execute(sql`select id from contact_groups where id = any(${sql.raw(`ARRAY[${d.groupIds.map((i) => `'${i}'`).join(',')}]::uuid[]`)})`);
    if ((groups as unknown as unknown[]).length !== d.groupIds.length) return fail('One of the groups no longer exists.');
    const hasCopy = ((t.buttons ?? []) as { type: string }[]).some((b) => b.type === 'copy_code');
    const offerCfg = t.offer as { hasExpiration?: boolean } | null;
    if (hasCopy && !d.offerCode) return fail('This message format has a Copy code button. Enter the offer code.');
    let offerEnds: Date | null = null;
    if (offerCfg?.hasExpiration) {
      offerEnds = d.offerEndsAt ? new Date(d.offerEndsAt) : null;
      if (!offerEnds || Number.isNaN(offerEnds.getTime())) return fail('This offer has a countdown. Choose when the offer ends.');
      // The countdown must still be running when the LAST message goes out; a repeating send keeps the same end time, so it must outlive the first run.
      const firstRun = when ?? new Date();
      if (offerEnds.getTime() < firstRun.getTime() + 60 * 60_000) return fail('The offer must end at least an hour after the message is sent.');
      if (offerEnds.getTime() > firstRun.getTime() + 60 * 86_400_000) return fail('The offer can end at most 60 days after the message is sent.');
      if (d.repeat !== 'none') return fail('A countdown offer cannot repeat, because it would run out. Send it once.');
    }
    const needed = new Set(variablesIn(t.body)).size;
    if (d.varMap.length !== needed) return fail(needed ? `This message format has ${needed} variable${needed > 1 ? 's' : ''}. Fill in each one.` : 'This message format has no variables.');
    const aud = await previewAudience(d.groupIds, t.category);
    if (aud.sendable === 0) return fail('No contact in these groups has agreed to messages, so there is nobody to send to.');
    const capPaise = d.spendCapRupees ? Math.round(d.spendCapRupees * 100) : null;
    if (capPaise !== null && aud.cost.totalPaise > capPaise) return fail(`The estimated cost ${aud.cost.totalLabel} is above your spend cap. Raise the cap or choose fewer people.`);
    const [row] = await tx.insert(campaigns).values({
      tenantId: g.ctx.tenantId, name: d.name, templateId: t.id, groupIds: d.groupIds, status: d.when === 'now' ? 'draft' : 'scheduled', scheduledAt: when, repeat: d.repeat,
      estCostPaise: aud.cost.totalPaise, spendCapPaise: capPaise, counts: { audience: aud.sendable, optedOut: aud.optedOut, noRecord: aud.noRecord }, createdBy: g.ctx.user.id, varMap: d.varMap, offerCode: hasCopy ? d.offerCode! : null, offerExpiresAt: offerEnds,
    }).returning({ id: campaigns.id, status: campaigns.status });
    await audit(tx, 'campaign.created', 'campaign', row!.id, { audience: aud.sendable });
    revalidatePath('/campaigns');
    return { ok: true as const, data: { id: row!.id, status: row!.status } };
  });
}

/** Deterministic spread so a test run looks like a real one without pretending to be one. */
function simulate(i: number): 'delivered' | 'read' | 'replied' | 'failed' {
  const h = (i * 2654435761) % 100;
  if (h < 5) return 'failed'; if (h < 12) return 'replied'; if (h < 55) return 'read'; return 'delivered';
}

/** True when this workspace has a valid WhatsApp connection with a number, so sends go to the real queue. */
export async function connectionState(): Promise<{ live: boolean }> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const r = await tx.execute(sql`select exists(select 1 from meta_accounts a join phone_numbers p on p.meta_account_id = a.id where a.token_status = 'valid' and a.health_state = 'ok') as live`);
    return { live: !!(r as unknown as { live: boolean }[])[0]?.live };
  });
}

/**
 * Hands a campaign to the real pipeline. The worker's launcher (every 15 s) expands it, re-checks every rule per contact, and sends.
 * Nothing is sent from the web process.
 */
async function queueForWorker(id: string): Promise<Result<{ sent: number; testMode: false }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const r = await tx.execute(sql`update campaigns set status = 'scheduled', scheduled_at = least(coalesce(scheduled_at, now()), now()) where id = ${id} and status in ('draft','scheduled','paused') returning (counts->>'audience')::int as n`);
    const row = (r as unknown as { n: number | null }[])[0];
    if (!row) return fail('This campaign has already been sent.');
    await audit(tx, 'campaign.queued', 'campaign', id, { audience: row.n });
    revalidatePath('/campaigns');
    return { ok: true as const, data: { sent: row.n ?? 0, testMode: false as const } };
  });
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
    const rows = await tx.execute(sql`
      select distinct on (c.id) c.id, c.phone_e164, c.name, c.consent_status
      from contacts c join contact_group_members m on m.contact_id = c.id
      where m.group_id = any(${sql.raw(`ARRAY[${c.groupIds.map((i) => `'${i}'`).join(',')}]::uuid[]`)}) order by c.id`);
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
  return db(g.ctx, async (tx) => {
    const r = await tx.update(campaigns).set({ status: 'cancelled' }).where(and(eq(campaigns.id, id), inArray(campaigns.status, ['draft', 'scheduled', 'paused']))).returning({ id: campaigns.id });
    if (!r.length) return fail('Only a campaign that has not started can be cancelled.');
    revalidatePath('/campaigns');
    return { ok: true as const, data: null };
  });
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

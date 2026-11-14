'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { audienceWhere, contactGroups } from '@lbc/db';
import { describeRule, parseSegmentFilter, segmentFilter, type SegmentFilter } from '@lbc/shared';
import { Forbidden, assertRole, audit, db, requireCtx } from '@/lib/session';

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function adminCtx() {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return null; throw e; }
  return ctx;
}

/** Names the rule pickers need: this workspace's campaigns, lead sources and tags. */
export interface SegmentOptions { campaigns: { id: string; name: string }[]; sources: { id: string; name: string }[]; tags: string[] }
export async function segmentOptions(): Promise<SegmentOptions> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const c = (await tx.execute(sql`select id, name from campaigns where status in ('completed','running','paused') order by created_at desc limit 100`)) as unknown as { id: string; name: string }[];
    const s = (await tx.execute(sql`select id, name from lead_sources order by name`)) as unknown as { id: string; name: string }[];
    const t = (await tx.execute(sql`select distinct unnest(tags) as tag from contacts order by 1 limit 200`)) as unknown as { tag: string }[];
    return { campaigns: c, sources: s, tags: t.map((x) => x.tag) };
  });
}

export interface SegmentPreview { total: number; sendable: number; optedOut: number; noRecord: number; sample: string[] }
/** How many people the rules pick right now, and how many of them could actually be messaged. */
export async function previewSegment(filter: SegmentFilter): Promise<Result<SegmentPreview>> {
  const ctx = await requireCtx();
  const p = segmentFilter.safeParse(filter);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the rules.');
  return db(ctx, async (tx) => {
    const where = audienceWhere(ctx.tenantId, [{ id: 'preview', kind: 'smart', filter: p.data }]);
    const [r] = (await tx.execute(sql`select count(*)::int total, count(*) filter (where c.consent_status = 'allowed')::int sendable, count(*) filter (where c.consent_status = 'stopped')::int opted_out, count(*) filter (where c.consent_status = 'unknown')::int no_record from contacts c where c.tenant_id = ${ctx.tenantId}::uuid and ${where}`)) as unknown as { total: number; sendable: number; opted_out: number; no_record: number }[];
    const sample = (await tx.execute(sql`select coalesce(nullif(c.name, ''), c.phone_e164) as n from contacts c where c.tenant_id = ${ctx.tenantId}::uuid and ${where} order by c.created_at desc limit 5`)) as unknown as { n: string }[];
    return { ok: true as const, data: { total: r!.total, sendable: r!.sendable, optedOut: r!.opted_out, noRecord: r!.no_record, sample: sample.map((x) => x.n) } };
  });
}

/** Rules are checked against this workspace: a campaign or source id from elsewhere is refused, not silently ignored. */
async function checkOwnership(tx: Parameters<Parameters<typeof db>[1]>[0], f: SegmentFilter): Promise<string | null> {
  const camp = [...new Set(f.rules.flatMap((r) => (r.type === 'campaign' ? [r.campaignId] : [])))];
  const src = [...new Set(f.rules.flatMap((r) => (r.type === 'lead_source' ? [r.sourceId] : [])))];
  if (camp.length) { const n = (await tx.execute(sql`select count(*)::int n from campaigns where id = any(${'{' + camp.join(',') + '}'}::uuid[])`)) as unknown as { n: number }[]; if (n[0]!.n !== camp.length) return 'One of the campaigns in your rules was not found.'; }
  if (src.length) { const n = (await tx.execute(sql`select count(*)::int n from lead_sources where id = any(${'{' + src.join(',') + '}'}::uuid[])`)) as unknown as { n: number }[]; if (n[0]!.n !== src.length) return 'One of the lead sources in your rules was not found.'; }
  return null;
}

function cleanName(raw: string): string | null { const n = raw.trim(); return n.length >= 2 && n.length <= 80 ? n : null; }

export async function saveSegment(input: { id?: string; name: string; filter: SegmentFilter }): Promise<Result<{ id: string }>> {
  const ctx = await adminCtx(); if (!ctx) return fail('Your role cannot do this. Ask the workspace owner.');
  const name = cleanName(input.name); if (!name) return fail('Segment names need 2 to 80 characters.');
  const p = segmentFilter.safeParse(input.filter); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the rules.');
  return db(ctx, async (tx) => {
    const bad = await checkOwnership(tx, p.data); if (bad) return fail(bad);
    const dup = (await tx.execute(sql`select id from contact_groups where name = ${name} ${input.id ? sql`and id <> ${input.id}::uuid` : sql``}`)) as unknown as { id: string }[];
    if (dup.length) return fail('You already have a group with this name.');
    if (input.id) {
      const upd = (await tx.execute(sql`update contact_groups set name = ${name}, filter = ${JSON.stringify(p.data)}::jsonb, updated_at = now() where id = ${input.id}::uuid and kind = 'smart' returning id`)) as unknown as { id: string }[];
      if (!upd.length) return fail('That segment was not found.');
      await audit(tx, 'segment.updated', 'contact_group', input.id);
      revalidatePath('/contacts');
      return { ok: true as const, data: { id: input.id } };
    }
    const [row] = await tx.insert(contactGroups).values({ tenantId: ctx.tenantId, name, kind: 'smart', filter: p.data, createdBy: ctx.user.id }).returning({ id: contactGroups.id });
    await audit(tx, 'segment.created', 'contact_group', row!.id);
    revalidatePath('/contacts');
    return { ok: true as const, data: { id: row!.id } };
  });
}

/** Plain-language lines for each rule, for the group card. */
export async function describeSegment(id: string): Promise<Result<{ match: 'all' | 'any'; lines: string[] }>> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const [g] = (await tx.execute(sql`select filter from contact_groups where id = ${id}::uuid and kind = 'smart'`)) as unknown as { filter: unknown }[];
    const f = g ? parseSegmentFilter(g.filter) : null;
    if (!f) return fail('This segment’s rules could not be read. Edit it to fix them.');
    const campaigns = Object.fromEntries(((await tx.execute(sql`select id, name from campaigns`)) as unknown as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    const sources = Object.fromEntries(((await tx.execute(sql`select id, name from lead_sources`)) as unknown as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    return { ok: true as const, data: { match: f.match, lines: f.rules.map((r) => describeRule(r, { campaigns, sources })) } };
  });
}

export async function loadSegment(id: string): Promise<Result<{ name: string; filter: SegmentFilter }>> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const [g] = (await tx.execute(sql`select name, filter from contact_groups where id = ${id}::uuid and kind = 'smart'`)) as unknown as { name: string; filter: unknown }[];
    if (!g) return fail('That segment was not found.');
    const f = parseSegmentFilter(g.filter);
    return { ok: true as const, data: { name: g.name, filter: f ?? { match: 'all', rules: [] as never } } };
  });
}

'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CONSENT_MODES, LEAD_SOURCE_KINDS, LEAD_STATUSES } from '@lbc/shared';
import { Forbidden, assertRole, db, requireCtx, type Ctx } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, q: ReturnType<typeof sql>) => (await tx.execute(q)) as Row[];

async function guard(min: 'agent' | 'admin'): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, min); } catch (e) { if (e instanceof Forbidden) return { error: 'Your role cannot do this. Ask the workspace owner.' }; throw e; }
  return { ctx };
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const textArr = (a: string[]) => sql`(select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(a)}::jsonb) x)`;

/** Where the capture endpoint lives. Env only; never guessed from the request. */
export async function captureBase(): Promise<string | null> {
  return (process.env.WORKER_PUBLIC_URL ?? '').trim().replace(/\/+$/, '') || null;
}

export interface SourceRow {
  id: string; kind: string; name: string; publicId: string; secretHint: string | null; enabled: boolean; consentMode: string;
  tags: string[]; assignUserIds: string[]; groupId: string | null; leadCount: number; lastLeadAt: string | null; fieldMap: Record<string, string>; rejects7d: number;
}
export interface SourcesData { sources: SourceRow[]; base: string | null; members: { id: string; name: string }[]; groups: { id: string; name: string }[] }

export async function listSources(): Promise<SourcesData> {
  const ctx = await requireCtx();
  const base = await captureBase();
  return db(ctx, async (tx) => {
    const s = await rows(tx, sql`select s.*, (select count(*)::int from lead_rejects r where r.source_id = s.id and r.created_at > now() - interval '7 days') as rej from lead_sources s order by s.created_at desc`);
    const m = await rows(tx, sql`select m.user_id as id, u.name from tenant_members m join "user" u on u.id = m.user_id order by u.name`);
    const g = await rows(tx, sql`select id, name from contact_groups order by name`);
    return {
      base, members: m.map((x) => ({ id: x.id, name: x.name })), groups: g.map((x) => ({ id: x.id, name: x.name })),
      sources: s.map((x) => ({ id: x.id, kind: x.kind, name: x.name, publicId: x.public_id, secretHint: x.secret_hint, enabled: x.enabled, consentMode: x.consent_mode, tags: x.default_tags ?? [], assignUserIds: x.assign_user_ids ?? [], groupId: x.default_group_id, leadCount: x.lead_count, lastLeadAt: x.last_lead_at ? new Date(x.last_lead_at).toISOString() : null, fieldMap: x.field_map ?? {}, rejects7d: x.rej })),
    };
  });
}

const sourceSchema = z.object({
  name: z.string().trim().min(2, 'Give the source a name.').max(80),
  kind: z.enum(LEAD_SOURCE_KINDS).default('webhook'),
  consentMode: z.enum(CONSENT_MODES).default('none'),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  assignUserIds: z.array(z.string()).max(20).default([]),
  groupId: z.string().uuid().nullable().default(null),
  fieldMap: z.record(z.enum(['phone', 'name', 'email', 'consent']), z.string().trim().max(80)).default({}),
});
export type SourceInput = z.input<typeof sourceSchema>;

async function validateRefs(tx: Parameters<Parameters<typeof db>[1]>[0], v: z.output<typeof sourceSchema>): Promise<string | null> {
  if (v.groupId && !(await rows(tx, sql`select 1 from contact_groups where id = ${v.groupId}`)).length) return 'That group does not exist.';
  if (v.assignUserIds.length) {
    const ok = await rows(tx, sql`select user_id from tenant_members where user_id in (select jsonb_array_elements_text(${JSON.stringify(v.assignUserIds)}::jsonb))`);
    if (ok.length !== new Set(v.assignUserIds).size) return 'Only members of this workspace can be assigned leads.';
  }
  return null;
}

/** Creates a source and returns its key ONCE. Only a hash is stored, so a lost key means rotating, never recovering. */
export async function createSource(input: SourceInput, attest?: boolean): Promise<Result<{ id: string; publicId: string; secret: string }>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  const p = sourceSchema.safeParse(input); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  if (p.data.consentMode === 'attested' && !attest) return fail('Tick the box to confirm your form shows a clear WhatsApp opt-in.');
  const publicId = 'src_' + randomBytes(9).toString('base64url');
  const secret = 'lbk_' + randomBytes(24).toString('base64url');
  return db(g.ctx, async (tx) => {
    const bad = await validateRefs(tx, p.data); if (bad) return fail(bad);
    const att = p.data.consentMode === 'attested';
    const r = await rows(tx, sql`insert into lead_sources (tenant_id, kind, name, public_id, secret_hash, secret_hint, consent_mode, attested_by, attested_at, default_tags, assign_user_ids, default_group_id, field_map)
      values (${g.ctx.tenantId}, ${p.data.kind}, ${p.data.name}, ${publicId}, ${hash(secret)}, ${secret.slice(0, 8) + '…' + secret.slice(-4)}, ${p.data.consentMode}, ${att ? g.ctx.user.id : null}, ${att ? sql`now()` : null},
        ${textArr(p.data.tags)}, ${textArr(p.data.assignUserIds)}, ${p.data.groupId}, ${JSON.stringify(p.data.fieldMap)}::jsonb) returning id`);
    await tx.execute(sql`select public.write_audit('lead_source.created', 'lead_source', ${r[0]!.id as string}, ${JSON.stringify({ name: p.data.name, consentMode: p.data.consentMode })}::jsonb)`);
    revalidatePath('/leads');
    return { ok: true as const, data: { id: r[0]!.id as string, publicId, secret } };
  });
}

export async function updateSource(id: string, input: SourceInput, attest?: boolean): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  const p = sourceSchema.safeParse(input); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  return db(g.ctx, async (tx) => {
    const cur = (await rows(tx, sql`select consent_mode, attested_by from lead_sources where id = ${id}`))[0];
    if (!cur) return fail('Source not found.');
    const att = p.data.consentMode === 'attested';
    // Loosening consent is a decision someone must own. Moving to "attested" needs a fresh confirmation, recorded with who and when.
    if (att && cur.consent_mode !== 'attested' && !attest) return fail('Tick the box to confirm your form shows a clear WhatsApp opt-in.');
    const bad = await validateRefs(tx, p.data); if (bad) return fail(bad);
    await tx.execute(sql`update lead_sources set name = ${p.data.name}, kind = ${p.data.kind}, consent_mode = ${p.data.consentMode},
      attested_by = ${att ? (cur.consent_mode === 'attested' ? sql`attested_by` : g.ctx.user.id) : null}, attested_at = ${att ? (cur.consent_mode === 'attested' ? sql`attested_at` : sql`now()`) : null},
      default_tags = ${textArr(p.data.tags)}, assign_user_ids = ${textArr(p.data.assignUserIds)}, default_group_id = ${p.data.groupId}, field_map = ${JSON.stringify(p.data.fieldMap)}::jsonb, updated_at = now() where id = ${id}`);
    await tx.execute(sql`select public.write_audit('lead_source.updated', 'lead_source', ${id}, ${JSON.stringify({ consentMode: p.data.consentMode, from: cur.consent_mode })}::jsonb)`);
    revalidatePath('/leads');
    return { ok: true as const, data: null };
  });
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const r = await rows(tx, sql`update lead_sources set enabled = ${enabled}, updated_at = now() where id = ${id} returning id`);
    if (!r.length) return fail('Source not found.');
    await tx.execute(sql`select public.write_audit(${enabled ? 'lead_source.enabled' : 'lead_source.disabled'}, 'lead_source', ${id}, null)`);
    revalidatePath('/leads');
    return { ok: true as const, data: null };
  });
}

/** New key; the old one stops working at once. */
export async function rotateSourceKey(id: string): Promise<Result<{ secret: string }>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  const secret = 'lbk_' + randomBytes(24).toString('base64url');
  return db(g.ctx, async (tx) => {
    const r = await rows(tx, sql`update lead_sources set secret_hash = ${hash(secret)}, secret_hint = ${secret.slice(0, 8) + '…' + secret.slice(-4)}, updated_at = now() where id = ${id} returning id`);
    if (!r.length) return fail('Source not found.');
    await tx.execute(sql`select public.write_audit('lead_source.key_rotated', 'lead_source', ${id}, null)`);
    return { ok: true as const, data: { secret } };
  });
}

/** Deleting a source keeps its leads and contacts (source_id becomes empty). */
export async function deleteSource(id: string): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const r = await rows(tx, sql`delete from lead_sources where id = ${id} returning id`);
    if (!r.length) return fail('Source not found.');
    await tx.execute(sql`select public.write_audit('lead_source.deleted', 'lead_source', ${id}, null)`);
    revalidatePath('/leads');
    return { ok: true as const, data: null };
  });
}

/* ------------------------------------------------------------------ the lead inbox */
export interface LeadRow {
  id: string; status: string; name: string | null; phone: string; email: string | null; consent: string; sourceName: string | null; sourceKind: string | null;
  ownerId: string | null; ownerName: string | null; valueRupees: number; utmSource: string | null; utmCampaign: string | null; sourceUrl: string | null;
  submissions: number; createdAt: string; firstResponseAt: string | null; fields: Record<string, string>; note: string | null; contactId: string;
}
export interface LeadFilter { status?: string; sourceId?: string; ownerId?: string; q?: string; mine?: boolean; page?: number }
export interface LeadsData { rows: LeadRow[]; total: number; counts: Record<string, number>; page: number; pageSize: number; members: { id: string; name: string }[]; sources: { id: string; name: string }[]; me: string }
const PAGE = 25;

export async function listLeads(f: LeadFilter = {}): Promise<LeadsData> {
  const ctx = await requireCtx();
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const q = (f.q ?? '').trim().slice(0, 80);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%` : null;
  const status = f.status && (LEAD_STATUSES as readonly string[]).includes(f.status) ? f.status : null;
  return db(ctx, async (tx) => {
    const where = sql`(${status}::text is null or l.status = ${status}) and (${f.sourceId ?? null}::uuid is null or l.source_id = ${f.sourceId ?? null}::uuid)
      and (${f.ownerId ?? null}::text is null or l.owner_user_id = ${f.ownerId ?? null}) and (${f.mine ? ctx.user.id : null}::text is null or l.owner_user_id = ${f.mine ? ctx.user.id : null})
      and (${like}::text is null or c.name ilike ${like} or c.phone_e164 ilike ${like} or c.email ilike ${like})`;
    const total = Number((await rows(tx, sql`select count(*)::int as n from leads l join contacts c on c.id = l.contact_id where ${where}`))[0]!.n);
    const r = await rows(tx, sql`select l.*, c.name, c.phone_e164, c.email, c.consent_status, s.name as source_name, s.kind as source_kind, u.name as owner_name
      from leads l join contacts c on c.id = l.contact_id left join lead_sources s on s.id = l.source_id left join "user" u on u.id = l.owner_user_id
      where ${where} order by l.created_at desc, l.id limit ${PAGE} offset ${(page - 1) * PAGE}`);
    const cnt = await rows(tx, sql`select status, count(*)::int as n from leads group by status`);
    const m = await rows(tx, sql`select m.user_id as id, u.name from tenant_members m join "user" u on u.id = m.user_id order by u.name`);
    const s = await rows(tx, sql`select id, name from lead_sources order by name`);
    return {
      page, pageSize: PAGE, total, me: ctx.user.id, counts: Object.fromEntries(cnt.map((x) => [x.status, x.n])),
      members: m.map((x) => ({ id: x.id, name: x.name })), sources: s.map((x) => ({ id: x.id, name: x.name })),
      rows: r.map((x) => ({ id: x.id, status: x.status, name: x.name, phone: x.phone_e164, email: x.email, consent: x.consent_status, sourceName: x.source_name, sourceKind: x.source_kind, ownerId: x.owner_user_id, ownerName: x.owner_name,
        valueRupees: Number(x.value_paise) / 100, utmSource: x.utm?.utm_source ?? null, utmCampaign: x.utm?.utm_campaign ?? null, sourceUrl: x.source_url, submissions: x.submissions, createdAt: new Date(x.created_at).toISOString(),
        firstResponseAt: x.first_response_at ? new Date(x.first_response_at).toISOString() : null, fields: x.fields ?? {}, note: x.note, contactId: x.contact_id })),
    };
  });
}

export async function loadLeadEvents(leadId: string): Promise<{ kind: string; data: Record<string, unknown>; at: string; by: string | null }[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => (await rows(tx, sql`select e.kind, e.data, e.created_at, u.name as by from lead_events e left join "user" u on u.id = e.actor_user_id where e.lead_id = ${leadId} order by e.id desc limit 50`))
    .map((x) => ({ kind: x.kind, data: x.data ?? {}, at: new Date(x.created_at).toISOString(), by: x.by })));
}

async function event(tx: Parameters<Parameters<typeof db>[1]>[0], ctx: Ctx, leadId: string, kind: string, data: object) {
  await tx.execute(sql`insert into lead_events (tenant_id, lead_id, kind, data, actor_user_id) values (${ctx.tenantId}, ${leadId}, ${kind}, ${JSON.stringify(data)}::jsonb, ${ctx.user.id})`);
}

const patchSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.string().nullable().optional(),
  valueRupees: z.number().min(0).max(1_000_000_000).optional(),
  note: z.string().max(2000).nullable().optional(),
});
export async function updateLead(id: string, patch: z.input<typeof patchSchema>): Promise<Result> {
  const g = await guard('agent'); if ('error' in g) return fail(g.error);
  const p = patchSchema.safeParse(patch); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  return db(g.ctx, async (tx) => {
    const cur = (await rows(tx, sql`select status, owner_user_id from leads where id = ${id} for update`))[0];
    if (!cur) return fail('Lead not found.');
    if (p.data.ownerId !== undefined && p.data.ownerId !== null) {
      if (!(await rows(tx, sql`select 1 from tenant_members where user_id = ${p.data.ownerId}`)).length) return fail('Only members of this workspace can own a lead.');
    }
    // Re-opening a closed lead while another open one exists for the same person would break the one-open-lead rule; say so plainly.
    if (p.data.status && ['new', 'contacted', 'qualified'].includes(p.data.status) && !['new', 'contacted', 'qualified'].includes(cur.status)) {
      const dup = await rows(tx, sql`select 1 from leads l2 where l2.contact_id = (select contact_id from leads where id = ${id}) and l2.id <> ${id} and l2.status in ('new','contacted','qualified')`);
      if (dup.length) return fail('This person already has another open lead.');
    }
    await tx.execute(sql`update leads set status = coalesce(${p.data.status ?? null}, status),
      owner_user_id = case when ${p.data.ownerId !== undefined} then ${p.data.ownerId ?? null} else owner_user_id end,
      value_paise = coalesce(${p.data.valueRupees === undefined ? null : Math.round(p.data.valueRupees * 100)}::bigint, value_paise),
      note = case when ${p.data.note !== undefined} then ${p.data.note ?? null} else note end,
      first_response_at = case when ${p.data.status === 'contacted' || p.data.status === 'qualified' || p.data.status === 'won'} and first_response_at is null then now() else first_response_at end,
      updated_at = now() where id = ${id}`);
    if (p.data.status && p.data.status !== cur.status) await event(tx, g.ctx, id, 'status', { from: cur.status, to: p.data.status });
    if (p.data.ownerId !== undefined && p.data.ownerId !== cur.owner_user_id) await event(tx, g.ctx, id, 'assigned', { to: p.data.ownerId, how: 'manual' });
    if (p.data.valueRupees !== undefined) await event(tx, g.ctx, id, 'value', { rupees: p.data.valueRupees });
    if (p.data.note !== undefined) await event(tx, g.ctx, id, 'note', {});
    revalidatePath('/leads');
    return { ok: true as const, data: null };
  });
}

/** Bulk status change or assignment for the selected leads (max 200). */
export async function bulkUpdateLeads(ids: string[], patch: { status?: string; ownerId?: string | null }): Promise<Result<{ changed: number }>> {
  const g = await guard('agent'); if ('error' in g) return fail(g.error);
  if (!ids.length || ids.length > 200) return fail('Select between 1 and 200 leads.');
  const p = patchSchema.pick({ status: true, ownerId: true }).safeParse(patch); if (!p.success) return fail('Check the details.');
  return db(g.ctx, async (tx) => {
    if (p.data.ownerId && !(await rows(tx, sql`select 1 from tenant_members where user_id = ${p.data.ownerId}`)).length) return fail('Only members of this workspace can own a lead.');
    const idj = JSON.stringify(ids);
    const r = await rows(tx, sql`update leads set status = coalesce(${p.data.status ?? null}, status),
      owner_user_id = case when ${p.data.ownerId !== undefined} then ${p.data.ownerId ?? null} else owner_user_id end, updated_at = now()
      where id in (select jsonb_array_elements_text(${idj}::jsonb)::uuid) returning id`);
    for (const x of r) await event(tx, g.ctx, x.id, p.data.status ? 'status' : 'assigned', { to: p.data.status ?? p.data.ownerId, how: 'bulk' });
    revalidatePath('/leads');
    return { ok: true as const, data: { changed: r.length } };
  });
}

export async function rejectsFor(sourceId: string): Promise<{ reason: string; detail: string | null; at: string }[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => (await rows(tx, sql`select reason, detail, created_at from lead_rejects where source_id = ${sourceId} order by id desc limit 20`)).map((x) => ({ reason: x.reason, detail: x.detail, at: new Date(x.created_at).toISOString() })));
}

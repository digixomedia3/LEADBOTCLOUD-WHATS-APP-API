/**
 * Lead scoring on real data. Gathers what each lead actually did, then hands it to the tested maths in @lbc/shared/lead-score.
 * Everything runs as the acting workspace (row security on), and every read is pinned to the lead ids given.
 *
 * What counts, and what does not:
 *  - a reply: a message FROM the person, after the lead arrived (earlier chats do not make a new lead look hot);
 *  - a read: a message WE sent them that they read, after the lead arrived. Test messages and journey messages count like any other;
 *  - a click: a tracked link opened by a person. Link-preview robots (is_bot) never count.
 */
import { sql } from 'drizzle-orm';
import { WEIGHT_KEYS, parseWeights, scoreLead, weightsProblem, type LeadSignals, type Score, type Weights } from '@lbc/shared/lead-score';
import { auditAs, db, type ActorCtx } from '@/lib/tenant-db';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
type Tx = Parameters<Parameters<typeof db>[1]>[0];
/** Sorting or filtering by score means scoring every matching lead first. Past this many, the list says so instead of quietly using a part. */
export const SCORE_SCAN_LIMIT = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadWeights(tx: Tx, tenantId: string): Promise<Weights> {
  const r = (await tx.execute(sql`select lead_score_weights as w from tenants where id = ${tenantId}::uuid`)) as unknown as { w: unknown }[];
  return parseWeights(r[0]?.w);
}

/** Scores the given leads in four queries, however many there are. Leads that are not found (or belong to another workspace) are simply absent from the result. */
export async function scoreLeadsIn(tx: Tx, tenantId: string, leadIds: string[], now: Date = new Date()): Promise<Map<string, Score>> {
  const ids = [...new Set(leadIds)].filter((x) => UUID.test(x));
  const out = new Map<string, Score>();
  if (!ids.length) return out;
  const lit = '{' + ids.join(',') + '}';
  const w = await loadWeights(tx, tenantId);
  const base = (await tx.execute(sql`
    select l.id, l.status, l.value_paise, l.submissions, l.created_at, l.contact_id, c.consent_status, (c.email is not null and c.email <> '') as has_email
    from leads l join contacts c on c.id = l.contact_id
    where l.tenant_id = ${tenantId}::uuid and l.id = any(${lit}::uuid[])`)) as unknown as { id: string; status: string; value_paise: string; submissions: number; created_at: Date; contact_id: string; consent_status: string; has_email: boolean }[];
  if (!base.length) return out;

  // Replies and reads, from the conversation messages, only since each lead arrived.
  const talk = (await tx.execute(sql`
    select l.id as lead_id,
           count(*) filter (where m.direction = 'in')::int as replies,
           count(*) filter (where m.direction = 'out' and m.read_at is not null)::int as reads,
           max(m.created_at) filter (where m.direction = 'in') as last_reply,
           max(m.read_at) filter (where m.direction = 'out') as last_read
    from leads l join conversations v on v.contact_id = l.contact_id and v.tenant_id = l.tenant_id
    join messages m on m.conversation_id = v.id and m.tenant_id = l.tenant_id and m.created_at >= l.created_at
    where l.tenant_id = ${tenantId}::uuid and l.id = any(${lit}::uuid[]) group by l.id`)) as unknown as { lead_id: string; replies: number; reads: number; last_reply: Date | null; last_read: Date | null }[];

  // Clicks by people (never robots), through the tracked links that were created for this person.
  const clicks = (await tx.execute(sql`
    select l.id as lead_id, count(distinct k.code)::int as clicks, max(k.clicked_at) as last_click
    from leads l join campaign_recipients r on r.contact_id = l.contact_id and r.tenant_id = l.tenant_id
    join tracked_links t on t.campaign_recipient_id = r.id and t.tenant_id = l.tenant_id
    join link_clicks k on k.code = t.code and k.tenant_id = l.tenant_id and k.is_bot = false and k.clicked_at >= l.created_at
    where l.tenant_id = ${tenantId}::uuid and l.id = any(${lit}::uuid[]) group by l.id`)) as unknown as { lead_id: string; clicks: number; last_click: Date | null }[];

  const T = new Map(talk.map((x) => [x.lead_id, x])), K = new Map(clicks.map((x) => [x.lead_id, x]));
  for (const b of base) {
    const t = T.get(b.id), k = K.get(b.id);
    const times = [b.created_at, t?.last_reply, t?.last_read, k?.last_click].filter((d): d is Date => !!d).map((d) => new Date(d).getTime());
    const s: LeadSignals = {
      status: b.status, consent: b.consent_status, replies: t?.replies ?? 0, reads: t?.reads ?? 0, clicks: k?.clicks ?? 0, hasEmail: b.has_email,
      valuePaise: Number(b.value_paise), submissions: b.submissions, lastActivityAt: new Date(Math.max(...times)), now,
    };
    out.set(b.id, scoreLead(s, w));
  }
  return out;
}

export async function getScoringRules(ctx: ActorCtx): Promise<Weights> { return db(ctx, (tx) => loadWeights(tx, ctx.tenantId)); }

/** Saves the workspace's point values. Only owners and admins (the caller checks the role); the numbers are re-checked here. */
export async function saveScoringRules(ctx: ActorCtx, raw: unknown): Promise<Result<Weights>> {
  const problem = weightsProblem(raw); if (problem) return fail(problem);
  const w = parseWeights(raw);
  return db(ctx, async (tx) => {
    const before = await loadWeights(tx, ctx.tenantId);
    await tx.execute(sql`update tenants set lead_score_weights = ${JSON.stringify(w)}::jsonb, updated_at = now() where id = ${ctx.tenantId}::uuid`);
    const changed = WEIGHT_KEYS.filter((k) => before[k] !== w[k]).map((k) => ({ rule: k, from: before[k], to: w[k] }));
    await auditAs(tx, ctx, 'lead_scoring.updated', 'tenant', ctx.tenantId, { changed });
    return { ok: true as const, data: w };
  });
}

export async function resetScoringRules(ctx: ActorCtx): Promise<Result<Weights>> {
  return db(ctx, async (tx) => {
    await tx.execute(sql`update tenants set lead_score_weights = null, updated_at = now() where id = ${ctx.tenantId}::uuid`);
    await auditAs(tx, ctx, 'lead_scoring.reset', 'tenant', ctx.tenantId, {});
    return { ok: true as const, data: await loadWeights(tx, ctx.tenantId) };
  });
}

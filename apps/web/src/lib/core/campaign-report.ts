/**
 * Campaign report data, shared by the report page, the CSV export and the API for AI agents.
 * Everything runs as the acting workspace (row security on), and every query is pinned to the campaign id.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { abHeadline, compareVersions, MIN_PER_VERSION, suggestedWinner, type AbResult, type VersionCounts } from '@lbc/shared/ab-test';
import { billedCost, buildFunnel, countRecipients, groupReasons, outcomeBreakdown, type CostSummary, type FunnelStep } from '@lbc/shared/campaign-report';
import { db, type ActorCtx } from '@/lib/tenant-db';
import { fail, type Result } from './campaigns';

const uuid = z.string().uuid();

export interface CampaignReportData {
  id: string; name: string; status: string; template: string | null; category: string | null; groups: string[];
  scheduledAt: string | null; startedAt: string | null; completedAt: string | null; pauseReason: string | null;
  estCostPaise: number; funnel: FunnelStep[]; outcomes: { label: string; count: number }[];
  reasons: { reason: string; state: 'failed' | 'skipped' | 'capped'; count: number }[];
  /** What Meta marked billable, priced from our rate table. An estimate, not Meta's invoice. */
  billed: CostSummary & { billableMessages: number; /** Real messages for which Meta has not reported pricing yet (it arrives with delivery receipts). */ awaitingPricing: number };
  /** True when no real WhatsApp message exists behind these numbers (test mode). */
  simulated: boolean;
  offer: { code: string | null; endsAt: string | null };
  /** Messages sent per hour over the first day, for the sparkline. */
  sendsByHour: { hour: string; count: number }[];
  /** Only present when the template has a tracked website button. People = different people who clicked; robots (link previews, scanners) are never counted. */
  clicks: { destination: string; people: number; total: number; botVisits: number; ofDelivered: number | null } | null;
  /** Only present when the campaign was an A/B test. Each person is counted once, in the version they got. */
  abTest: null | {
    percentB: number; minPerVersion: number; headline: string; result: AbResult;
    /** Set when the rest of the audience is being kept back for the winner. */
    hold: null | { testPct: number; held: number; suggested: 'a' | 'b' | null; releasedVersion: 'a' | 'b' | null; releaseWaiting: boolean; releasedAt: Date | null; error: string | null; /** Everyone in the test group has been sent to, so the comparison is final. */ testDone: boolean };
    a: { template: string | null; counts: VersionCounts }; b: { template: string | null; counts: VersionCounts };
  };
}

export async function campaignReportFor(ctx: ActorCtx, id: string): Promise<Result<CampaignReportData>> {
  if (!uuid.safeParse(id).success) return fail('That campaign id is not valid.');
  return db(ctx, async (tx) => {
    const [c] = (await tx.execute(sql`
      select c.id, c.name, c.status, c.scheduled_at, c.started_at, c.completed_at, c.pause_reason, c.est_cost_paise, c.group_ids, c.offer_code, c.offer_expires_at, c.link_url, t.name as tname, t.category, c.ab_template_id, c.ab_percent_b, c.ab_hold_rest, c.ab_test_pct, c.ab_release_version, c.ab_released_at, c.ab_release_error, tb.name as tbname
      from campaigns c left join templates t on t.id = c.template_id left join templates tb on tb.id = c.ab_template_id where c.id = ${id}::uuid`)) as unknown as { id: string; name: string; status: string; scheduled_at: Date | null; started_at: Date | null; completed_at: Date | null; pause_reason: string | null; est_cost_paise: number; group_ids: string[]; offer_code: string | null; offer_expires_at: Date | null; link_url: string | null; ab_template_id: string | null; ab_percent_b: number | null; ab_hold_rest: boolean; ab_test_pct: number | null; ab_release_version: string | null; ab_released_at: Date | null; ab_release_error: string | null; tbname: string | null; tname: string | null; category: string | null }[];
    if (!c) return fail('That campaign was not found.');
    const recs = (await tx.execute(sql`select state, reason, version, phase from campaign_recipients where campaign_id = ${id}::uuid`)) as unknown as { state: string; reason: string | null; version: string; phase: string }[];
    const counts = countRecipients(recs.map((r) => r.state));
    const billable = (await tx.execute(sql`
      select lower(coalesce(m.pricing_category, m.template_category, '')) as category, count(*)::int as messages
      from messages m join campaign_recipients r on r.id = m.campaign_recipient_id
      where r.campaign_id = ${id}::uuid and m.billable is true group by 1`)) as unknown as { category: string; messages: number }[];
    const [{ n: real, w: waiting } = { n: 0, w: 0 }] = (await tx.execute(sql`select count(*)::int as n, count(*) filter (where m.billable is null and m.status not in ('failed'))::int as w from messages m join campaign_recipients r on r.id = m.campaign_recipient_id where r.campaign_id = ${id}::uuid`)) as unknown as { n: number; w: number }[];
    const hours = (await tx.execute(sql`
      select to_char(date_trunc('hour', sent_at at time zone 'Asia/Kolkata'), 'DD Mon HH24:00') as hour, count(*)::int as count
      from campaign_recipients where campaign_id = ${id}::uuid and sent_at is not null group by date_trunc('hour', sent_at at time zone 'Asia/Kolkata') order by date_trunc('hour', sent_at at time zone 'Asia/Kolkata') limit 48`)) as unknown as { hour: string; count: number }[];
    let clicks: CampaignReportData['clicks'] = null;
    if (c.link_url) {
      const [k] = (await tx.execute(sql`
        select count(distinct k.code) filter (where k.is_bot = false)::int as people, count(*) filter (where k.is_bot = false)::int as total, count(*) filter (where k.is_bot = true)::int as bots
        from link_clicks k where k.campaign_id = ${id}::uuid`)) as unknown as { people: number; total: number; bots: number }[];
      const delivered = counts.sent; // people actually messaged; a click can arrive before the delivery receipt does
      clicks = { destination: c.link_url, people: k?.people ?? 0, total: k?.total ?? 0, botVisits: k?.bots ?? 0, ofDelivered: delivered > 0 ? Math.round(((k?.people ?? 0) / delivered) * 1000) / 10 : null };
    }
    const names = c.group_ids.length ? ((await tx.execute(sql`select name from contact_groups where id = any(${'{' + c.group_ids.filter((g) => /^[0-9a-f-]{36}$/i.test(g)).join(',') + '}'}::uuid[]) order by name`)) as unknown as { name: string }[]).map((g) => g.name) : [];
    // A/B: split the people who were actually messaged by version. Skipped people never received anything, so they belong to neither group.
    let abTest: CampaignReportData['abTest'] = null;
    if (c.ab_template_id && c.ab_percent_b) {
      // countRecipients already leaves skipped people out of every measure below, so a person who was never messaged cannot appear in either group.
      const by = (v: string): VersionCounts => {
        const k = countRecipients(recs.filter((r) => r.version === v && r.phase === 'test').map((r) => r.state));
        return { received: k.sent + k.failed + k.capped + k.queued, delivered: k.delivered, read: k.read, replied: k.replied };
      };
      const ca = by('a'), cb = by('b'); const result = compareVersions(ca, cb);
      const heldN = recs.filter((r) => r.state === 'held').length;
      const testStates = recs.filter((r) => r.phase === 'test' && r.state !== 'skipped').map((r) => r.state);
      const hold = c.ab_hold_rest ? {
        testPct: c.ab_test_pct ?? 0, held: heldN, suggested: suggestedWinner(result),
        releasedVersion: c.ab_released_at ? (c.ab_release_version as 'a' | 'b' | null) : null, releaseWaiting: !!c.ab_release_version && !c.ab_released_at,
        releasedAt: c.ab_released_at, error: c.ab_release_error, testDone: testStates.length > 0 && !testStates.some((x) => x === 'queued' || x === 'retry_wait'),
      } : null;
      abTest = { percentB: c.ab_percent_b, minPerVersion: MIN_PER_VERSION, hold, headline: abHeadline(result, `Version A (${c.tname ?? 'template'})`, `Version B (${c.tbname ?? 'template'})`), result,
        a: { template: c.tname, counts: ca }, b: { template: c.tbname, counts: cb } };
    }
    const billed = billedCost(billable.map((b) => ({ category: b.category || null, messages: b.messages })));
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    return {
      ok: true as const,
      data: {
        id: c.id, name: c.name, status: c.status, template: c.tname, category: c.category, groups: names,
        scheduledAt: iso(c.scheduled_at), startedAt: iso(c.started_at), completedAt: iso(c.completed_at), pauseReason: c.pause_reason, estCostPaise: c.est_cost_paise,
        funnel: buildFunnel(counts), outcomes: outcomeBreakdown(counts), reasons: groupReasons(recs),
        billed: { ...billed, billableMessages: billable.reduce((n, b) => n + b.messages, 0), awaitingPricing: waiting },
        simulated: real === 0 && counts.sent > 0,
        offer: { code: c.offer_code, endsAt: iso(c.offer_expires_at) },
        sendsByHour: hours, clicks, abTest,
      },
    };
  });
}

export const RESULT_FILTERS = ['all', 'replied', 'read', 'delivered', 'sent', 'failed', 'skipped', 'capped', 'waiting'] as const;
export type ResultFilter = (typeof RESULT_FILTERS)[number];
const STATES: Record<Exclude<ResultFilter, 'all'>, string[]> = {
  replied: ['replied'], read: ['read'], delivered: ['delivered'], sent: ['sent'], failed: ['failed'], skipped: ['skipped'], capped: ['capped'], waiting: ['queued', 'retry_wait'],
};
const stateList = (f: ResultFilter) => (f === 'all' ? null : '{' + STATES[f].join(',') + '}');

export interface RecipientRow { name: string | null; phone: string; state: string; reason: string | null; sentAt: string | null }

/** One page of people, optionally narrowed to one result. Page size is fixed at 50. */
export async function campaignRecipientsFor(ctx: ActorCtx, id: string, filter: ResultFilter, page: number): Promise<Result<{ rows: RecipientRow[]; total: number; page: number; pages: number }>> {
  if (!uuid.safeParse(id).success) return fail('That campaign id is not valid.');
  if (!RESULT_FILTERS.includes(filter)) return fail('Unknown filter.');
  const p = Math.max(1, Math.min(10_000, Math.trunc(page) || 1));
  return db(ctx, async (tx) => {
    const lit = stateList(filter);
    const where = lit ? sql`campaign_id = ${id}::uuid and state = any(${lit}::text[])` : sql`campaign_id = ${id}::uuid`;
    const [t] = (await tx.execute(sql`select count(*)::int as n from campaign_recipients where ${where}`)) as unknown as { n: number }[];
    const rows = (await tx.execute(sql`select name, phone_e164, state, reason, sent_at from campaign_recipients where ${where} order by coalesce(sent_at, 'epoch'::timestamptz) desc, id limit 50 offset ${(p - 1) * 50}`)) as unknown as { name: string | null; phone_e164: string; state: string; reason: string | null; sent_at: Date | null }[];
    return { ok: true as const, data: { rows: rows.map((r) => ({ name: r.name, phone: r.phone_e164, state: r.state, reason: r.reason, sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null })), total: t!.n, page: p, pages: Math.max(1, Math.ceil(t!.n / 50)) } };
  });
}

export const EXPORT_LIMIT = 50_000;
/** Every person for the CSV, capped so one request cannot pull an unbounded amount. `truncated` says so rather than hiding it. */
export async function campaignExportRows(ctx: ActorCtx, id: string, filter: ResultFilter, limit: number = EXPORT_LIMIT): Promise<Result<{ name: string; rows: { name: string | null; phone: string; state: string; reason: string | null; sentAt: Date | null }[]; truncated: boolean }>> {
  if (!uuid.safeParse(id).success) return fail('That campaign id is not valid.');
  if (!RESULT_FILTERS.includes(filter)) return fail('Unknown filter.');
  return db(ctx, async (tx) => {
    const [c] = (await tx.execute(sql`select name from campaigns where id = ${id}::uuid`)) as unknown as { name: string }[];
    if (!c) return fail('That campaign was not found.');
    const lit = stateList(filter);
    const where = lit ? sql`campaign_id = ${id}::uuid and state = any(${lit}::text[])` : sql`campaign_id = ${id}::uuid`;
    const rows = (await tx.execute(sql`select name, phone_e164, state, reason, sent_at from campaign_recipients where ${where} order by coalesce(sent_at, 'epoch'::timestamptz) desc, id limit ${limit + 1}`)) as unknown as { name: string | null; phone_e164: string; state: string; reason: string | null; sent_at: Date | null }[];
    const truncated = rows.length > limit;
    return { ok: true as const, data: { name: c.name, truncated, rows: rows.slice(0, limit).map((r) => ({ name: r.name, phone: r.phone_e164, state: r.state, reason: r.reason, sentAt: r.sent_at })) } };
  });
}

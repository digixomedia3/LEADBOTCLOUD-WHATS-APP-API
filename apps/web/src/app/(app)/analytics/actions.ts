'use server';

import { sql } from 'drizzle-orm';
import { errorPolicy, estimateCost, inr } from '@lbc/shared';
import { db, requireCtx } from '@/lib/session';

type R = Record<string, unknown>;
const rows = (r: unknown) => r as R[];
const num = (v: unknown) => Number(v ?? 0);
const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export type Range = 7 | 30 | 90;
export interface Analytics {
  range: Range;
  totals: { sent: number; delivered: number; read: number; replied: number; failed: number; capped: number; skipped: number; optedOut: number; newOptOuts: number; inbound: number };
  days: { label: string; sent: number; delivered: number; read: number }[];
  campaigns: { id: string; name: string; template: string | null; at: string; sent: number; delivered: number; read: number; replied: number; failed: number; deliveredPct: number; readPct: number; replyPct: number; costLabel: string }[];
  reasons: { code: number | null; text: string; count: number }[];
  hours: { hour: number; sent: number; readPct: number }[];
  bestHour: { label: string; readPct: number; sent: number } | null;
  spendLabel: string;
  billableMessages: number;
  empty: boolean;
}

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? ' am' : ' pm'}`;

/** Reports for the signed-in workspace only (RLS). Counts come from campaign_recipients and messages, never from stored totals. */
export async function getAnalytics(range: Range): Promise<Analytics> {
  const ctx = await requireCtx();
  const days = range === 7 || range === 30 || range === 90 ? range : 30;
  return db(ctx, async (tx) => {
    const t = rows(await tx.execute(sql`
      select count(*) filter (where r.state <> 'skipped' and r.sent_at is not null)::int sent,
             count(*) filter (where r.state in ('delivered','read','replied'))::int delivered,
             count(*) filter (where r.state in ('read','replied'))::int read,
             count(*) filter (where r.state = 'replied')::int replied,
             count(*) filter (where r.state = 'failed')::int failed,
             count(*) filter (where r.state = 'capped')::int capped,
             count(*) filter (where r.state = 'skipped')::int skipped,
             count(*) filter (where r.state = 'skipped' and r.reason = 'Opted out')::int opted_out
      from campaign_recipients r join campaigns c on c.id = r.campaign_id
      where coalesce(r.sent_at, c.started_at, c.created_at) > now() - make_interval(days => ${days})`))[0]!;
    const inbound = num(rows(await tx.execute(sql`select count(*)::int n from messages where direction = 'in' and created_at > now() - make_interval(days => ${days})`))[0]?.n);
    const newOpt = num(rows(await tx.execute(sql`select count(*)::int n from contact_consent_events where action = 'opt_out' and occurred_at > now() - make_interval(days => ${days})`))[0]?.n);

    const perDay = rows(await tx.execute(sql`
      select to_char((sent_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') d,
             count(*) filter (where state <> 'skipped')::int sent,
             count(*) filter (where state in ('delivered','read','replied'))::int delivered,
             count(*) filter (where state in ('read','replied'))::int read
      from campaign_recipients where sent_at > now() - make_interval(days => ${days}) group by 1`));
    const by = new Map(perDay.map((r) => [String(r.d), r]));
    const today = new Date(Date.now() + 5.5 * 3_600_000);
    const series: Analytics['days'] = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = new Date(today.getTime() - i * 86_400_000);
      const key = k.toISOString().slice(0, 10);
      const show = days <= 14 || i % Math.ceil(days / 14) === 0;
      series.push({ label: show ? `${k.getUTCDate()} ${k.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}` : '', sent: num(by.get(key)?.sent), delivered: num(by.get(key)?.delivered), read: num(by.get(key)?.read) });
    }

    const camps = rows(await tx.execute(sql`
      select c.id, c.name, tp.name template, tp.category, coalesce(c.started_at, c.scheduled_at, c.created_at) at,
             count(r.*) filter (where r.state <> 'skipped' and r.sent_at is not null)::int sent,
             count(r.*) filter (where r.state in ('delivered','read','replied'))::int delivered,
             count(r.*) filter (where r.state in ('read','replied'))::int read,
             count(r.*) filter (where r.state = 'replied')::int replied,
             count(r.*) filter (where r.state in ('failed','capped'))::int failed
      from campaigns c left join templates tp on tp.id = c.template_id left join campaign_recipients r on r.campaign_id = c.id
      where c.status in ('running','completed') and coalesce(c.started_at, c.created_at) > now() - make_interval(days => ${days})
      group by c.id, tp.name, tp.category order by at desc limit 15`));

    const reasonRows = rows(await tx.execute(sql`
      select error_code, count(*)::int n from messages
      where direction = 'out' and status = 'failed' and failed_at > now() - make_interval(days => ${days}) and error_code is not null
      group by 1 order by n desc limit 8`));
    const hourRows = rows(await tx.execute(sql`
      select extract(hour from sent_at at time zone 'Asia/Kolkata')::int h,
             count(*) filter (where state <> 'skipped')::int sent,
             count(*) filter (where state in ('read','replied'))::int read
      from campaign_recipients where sent_at > now() - make_interval(days => ${days}) group by 1 order by 1`));
    const billable = rows(await tx.execute(sql`
      select coalesce(pricing_category, template_category) cat, count(*)::int n from messages
      where direction = 'out' and billable = true and sent_at > now() - make_interval(days => ${days}) group by 1`));

    const hours = hourRows.map((h) => ({ hour: num(h.h), sent: num(h.sent), readPct: rate(num(h.read), num(h.sent)) }));
    const eligible = hours.filter((h) => h.sent >= 20);
    const best = eligible.length >= 2 ? [...eligible].sort((a, b) => b.readPct - a.readPct)[0]! : null;

    const spendPaise = billable.reduce((s, b) => s + estimateCost(num(b.n), String(b.cat ?? 'marketing').toLowerCase()).totalPaise, 0);
    const sent = num(t.sent);
    return {
      range: days as Range,
      totals: { sent, delivered: num(t.delivered), read: num(t.read), replied: num(t.replied), failed: num(t.failed), capped: num(t.capped), skipped: num(t.skipped), optedOut: num(t.opted_out), newOptOuts: newOpt, inbound },
      days: series,
      campaigns: camps.map((c) => {
        const s = num(c.sent);
        return { id: String(c.id), name: String(c.name), template: (c.template as string | null) ?? null, at: new Date(String(c.at)).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }), sent: s, delivered: num(c.delivered), read: num(c.read), replied: num(c.replied), failed: num(c.failed), deliveredPct: rate(num(c.delivered), s), readPct: rate(num(c.read), s), replyPct: rate(num(c.replied), s), costLabel: inr(estimateCost(s, String(c.category ?? 'marketing')).totalPaise) };
      }),
      reasons: reasonRows.map((r) => ({ code: num(r.error_code), text: errorPolicy(num(r.error_code)).en ?? `Meta error ${num(r.error_code)}`, count: num(r.n) })),
      hours,
      bestHour: best ? { label: hourLabel(best.hour), readPct: best.readPct, sent: best.sent } : null,
      spendLabel: inr(spendPaise),
      billableMessages: billable.reduce((s, b) => s + num(b.n), 0),
      empty: sent === 0 && inbound === 0,
    };
  });
}

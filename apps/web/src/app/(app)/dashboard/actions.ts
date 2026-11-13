'use server';

import { sql } from 'drizzle-orm';
import { db, requireCtx } from '@/lib/session';

type R = Record<string, unknown>;
const rows = (r: unknown) => r as R[];
const num = (v: unknown) => Number(v ?? 0);

export interface DayPoint { label: string; sent: number; delivered: number; read: number }
export interface Dashboard {
  workspace: string;
  hello: string;
  days: DayPoint[];
  totals: { sent: number; delivered: number; read: number; replies: number };
  /** Percent change against the previous 14 days. null when there is nothing to compare with. */
  delta: { sent: number | null; delivered: number | null; read: number | null; replies: number | null };
  spark: { sent: number[]; delivered: number[]; read: number[]; replies: number[] };
  scheduled: { id: string; name: string; when: string; audience: number; template: string | null }[];
  chats: { id: string; name: string; preview: string; ago: string; unread: number }[];
  number: null | { display: string | null; quality: string | null; tier: string | null; status: string | null; used24h: number; limit: number | null };
  connected: boolean;
  renewalsDue: number;
  repliesWeek: number;
  steps: { label: string; href: string; done: boolean }[];
  empty: boolean;
}

const TIER_LIMIT: Record<string, number | null> = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10_000, TIER_100K: 100_000, TIER_UNLIMITED: null, UNLIMITED: null };
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function ago(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Everything the dashboard shows, from the workspace's own data (RLS applies). Nothing here is sample data. */
export async function getDashboard(): Promise<Dashboard> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    // 28 days of recipient outcomes, bucketed by India date. Campaign results come from campaign_recipients (real sends and test sends alike).
    const perDay = rows(await tx.execute(sql`
      select to_char((sent_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') d,
             count(*) filter (where state <> 'skipped' and sent_at is not null)::int sent,
             count(*) filter (where state in ('delivered','read','replied'))::int delivered,
             count(*) filter (where state in ('read','replied'))::int read
      from campaign_recipients where sent_at > now() - interval '28 days' group by 1`));
    const repliesDay = rows(await tx.execute(sql`
      select to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') d, count(*)::int n
      from messages where direction = 'in' and created_at > now() - interval '28 days' group by 1`));

    const istToday = new Date(Date.now() + 5.5 * 3_600_000);
    const keys: string[] = [];
    for (let i = 27; i >= 0; i--) keys.push(new Date(istToday.getTime() - i * 86_400_000).toISOString().slice(0, 10));
    const by = new Map(perDay.map((r) => [String(r.d), r]));
    const rep = new Map(repliesDay.map((r) => [String(r.d), num(r.n)]));
    const series = keys.map((k) => ({ k, sent: num(by.get(k)?.sent), delivered: num(by.get(k)?.delivered), read: num(by.get(k)?.read), replies: rep.get(k) ?? 0 }));
    const cur = series.slice(14), prev = series.slice(0, 14);
    const sum = (a: typeof series, f: 'sent' | 'delivered' | 'read' | 'replies') => a.reduce((s, x) => s + x[f], 0);
    const label = (k: string, i: number) => { const d = new Date(k + 'T00:00:00Z'); return i % 2 === 0 ? `${d.getUTCDate()} ${d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}` : String(d.getUTCDate()); };

    const t = { sent: sum(cur, 'sent'), delivered: sum(cur, 'delivered'), read: sum(cur, 'read'), replies: sum(cur, 'replies') };
    const p = { sent: sum(prev, 'sent'), delivered: sum(prev, 'delivered'), read: sum(prev, 'read'), replies: sum(prev, 'replies') };

    const sched = rows(await tx.execute(sql`
      select c.id, c.name, c.scheduled_at, (c.counts->>'audience')::int audience, t.name template
      from campaigns c left join templates t on t.id = c.template_id
      where c.status = 'scheduled' order by c.scheduled_at nulls first limit 4`));
    const chats = rows(await tx.execute(sql`
      select v.id, coalesce(c.name, c.profile_name, c.phone_e164) name, v.last_preview, v.last_message_at, v.unread
      from conversations v join contacts c on c.id = v.contact_id
      where v.last_message_at is not null order by v.last_message_at desc limit 4`));
    const nr = rows(await tx.execute(sql`
      select p.display_phone_number, p.quality_rating, p.messaging_limit_tier, p.status, a.token_status, a.health_state
      from phone_numbers p join meta_accounts a on a.id = p.meta_account_id order by p.created_at limit 1`))[0];
    const used = nr ? num(rows(await tx.execute(sql`select count(distinct v.contact_id)::int n from messages m join conversations v on v.id = m.conversation_id where m.direction = 'out' and m.wamid is not null and m.template_name is not null and m.created_at > now() - interval '24 hours'`))[0]?.n) : 0;

    const flags = rows(await tx.execute(sql`select
      (select count(*) from contacts)::int contacts,
      (select count(*) from templates where status = 'approved')::int approved,
      (select count(*) from campaigns where status in ('completed','running'))::int sentCampaigns,
      (select count(*) from renewals where status not in ('renewed','cancelled'))::int renewalsOpen,
      (select count(*) from renewals where status not in ('renewed','cancelled') and due_on::date <= (now() at time zone 'Asia/Kolkata')::date + 7)::int renewalsDue,
      (select count(*) from automation_rules where active)::int rules`))[0]!;

    const connected = !!nr && nr.token_status === 'valid';
    const hour = istToday.getUTCHours();
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const tier = nr?.messaging_limit_tier ? String(nr.messaging_limit_tier) : null;
    const days = cur.map((x, i) => ({ label: label(x.k, i), sent: x.sent, delivered: x.delivered, read: x.read }));

    return {
      workspace: ctx.workspace.name, hello, days,
      totals: t,
      delta: { sent: pct(t.sent, p.sent), delivered: pct(rate(t.delivered, t.sent), rate(p.delivered, p.sent)), read: pct(rate(t.read, t.sent), rate(p.read, p.sent)), replies: pct(t.replies, p.replies) },
      spark: {
        sent: cur.map((x) => x.sent), replies: cur.map((x) => x.replies),
        delivered: cur.map((x) => rate(x.delivered, x.sent)), read: cur.map((x) => rate(x.read, x.sent)),
      },
      scheduled: sched.map((s) => ({ id: String(s.id), name: String(s.name), when: s.scheduled_at ? new Date(String(s.scheduled_at)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : 'On send', audience: num(s.audience), template: (s.template as string | null) ?? null })),
      chats: chats.map((c) => ({ id: String(c.id), name: String(c.name), preview: String(c.last_preview ?? ''), ago: ago(new Date(String(c.last_message_at))), unread: num(c.unread) })),
      number: nr ? { display: (nr.display_phone_number as string | null) ?? null, quality: (nr.quality_rating as string | null) ?? null, tier, status: (nr.status as string | null) ?? null, used24h: used, limit: tier && tier in TIER_LIMIT ? TIER_LIMIT[tier]! : null } : null,
      connected,
      renewalsDue: num(flags.renewalsdue),
      repliesWeek: sum(series.slice(21), 'replies'),
      steps: [
        { label: 'Connect WhatsApp', href: '/settings', done: connected },
        { label: 'Add contacts', href: '/contacts', done: num(flags.contacts) > 0 },
        { label: 'Get a message format approved', href: '/templates', done: num(flags.approved) > 0 },
        { label: 'Send your first campaign', href: '/campaigns', done: num(flags.sentcampaigns) > 0 },
        { label: 'Turn on renewal reminders', href: '/renewals', done: num(flags.renewalsopen) > 0 },
      ],
      empty: t.sent === 0 && p.sent === 0,
    };
  });
}

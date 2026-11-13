import Link from 'next/link';
import { ArrowRight, CalendarClock, CheckCircle2, Circle, MessageCircle, Plus, Send, Sparkles, TrendingUp, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CountUp } from '@/components/dashboard/count-up';
import { PerformanceChart } from '@/components/dashboard/performance-chart';
import { Ring } from '@/components/dashboard/ring';
import { Sparkline } from '@/components/dashboard/sparkline';
import { getDashboard } from './actions';

export const dynamic = 'force-dynamic';

const QUALITY: Record<string, { label: string; dot: string }> = {
  GREEN: { label: 'High', dot: 'bg-emerald-400' },
  YELLOW: { label: 'Medium', dot: 'bg-amber-400' },
  RED: { label: 'Low', dot: 'bg-rose-400' },
};

function Delta({ v }: { v: number | null }) {
  if (v === null) return <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-muted">New</span>;
  const up = v >= 0;
  return <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${up ? 'bg-brand/10 text-brand' : 'bg-rose/10 text-rose'}`}><TrendingUp className={`size-3 ${up ? '' : 'rotate-180'}`} />{up ? '+' : ''}{v}%</span>;
}

export default async function DashboardPage() {
  const d = await getDashboard();
  const doneCount = d.steps.filter((s) => s.done).length;
  const q = d.number?.quality ? QUALITY[d.number.quality] : undefined;
  const usedPct = d.number && d.number.limit ? Math.min(100, Math.round((d.number.used24h / d.number.limit) * 100)) : null;
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  const kpis = [
    { label: 'Messages sent', value: d.totals.sent, suffix: '', delta: d.delta.sent, data: d.spark.sent, color: '#6366f1' },
    { label: 'Delivered', value: rate(d.totals.delivered, d.totals.sent), suffix: '%', delta: d.delta.delivered, data: d.spark.delivered, color: '#06b6d4' },
    { label: 'Read rate', value: rate(d.totals.read, d.totals.sent), suffix: '%', delta: d.delta.read, data: d.spark.read, color: '#10b981' },
    { label: 'Replies', value: d.totals.replies, suffix: '', delta: d.delta.replies, data: d.spark.replies, color: '#f59e0b' },
  ];

  const summary = [
    d.repliesWeek ? `${d.repliesWeek.toLocaleString('en-IN')} ${d.repliesWeek === 1 ? 'reply' : 'replies'} this week.` : 'No replies yet this week.',
    d.renewalsDue ? `${d.renewalsDue} ${d.renewalsDue === 1 ? 'renewal is' : 'renewals are'} due within 7 days.` : null,
    d.scheduled[0] ? `Next send: ${d.scheduled[0].name}, ${d.scheduled[0].when}.` : null,
  ].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-5">
      {!d.connected ? (
        <div className="rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber">Test mode: no WhatsApp number is connected, so sends are simulated. Numbers below come from your own test sends and chats.</div>
      ) : null}

      <section className="aurora reveal rounded-3xl p-6 md:p-8" style={{ ['--i' as string]: 0 }}>
        <span className="blob" /><span className="aurora-grid" />
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold"><Sparkles className="size-3.5 text-emerald-300" />{d.hello}, {d.workspace}</p>
            <h2 className="font-display text-3xl font-extrabold leading-tight md:text-4xl">{d.empty ? <>Let’s send your <span className="grad-text">first message</span></> : <>Your WhatsApp is <span className="grad-text">working for you</span></>}</h2>
            <p className="mt-2 text-sm text-white/75 md:text-base">{d.empty ? 'Add contacts, get a message format approved, and send. Your numbers appear here as soon as you do.' : summary}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button asChild><Link href="/campaigns"><Send className="size-4" />Create campaign</Link></Button>
              <Button asChild variant="glass"><Link href="/contacts"><Upload className="size-4" />Import contacts</Link></Button>
            </div>
          </div>
          <div className="flex items-center gap-5">
            {d.number ? (
              <>
                {usedPct !== null ? <Ring value={usedPct} label="Daily limit" sub="used" /> : null}
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="text-white/80">{d.number.display ?? 'Your number'}</li>
                  <li className="flex items-center gap-2"><span className={`live-dot size-2.5 rounded-full ${q?.dot ?? 'bg-white/40'}`} />Quality: {q?.label ?? 'Not rated yet'}</li>
                  <li className="text-white/80">Last 24 h: <strong className="text-white">{d.number.used24h.toLocaleString('en-IN')}{d.number.limit ? ` / ${d.number.limit.toLocaleString('en-IN')}` : ''}</strong> people</li>
                  <li className="text-white/80">Status: <strong className={d.connected ? 'text-emerald-300' : 'text-amber-300'}>{d.connected ? (d.number.status ?? 'Connected') : 'Reconnect needed'}</strong></li>
                </ul>
              </>
            ) : (
              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-sm"><p className="font-semibold">No number connected</p><p className="mt-1 text-white/75">Connect WhatsApp in Settings to send for real.</p><Button asChild size="sm" variant="glass" className="mt-3"><Link href="/settings">Open Settings</Link></Button></div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key numbers">
        {kpis.map((k, i) => (
          <article key={k.label} className="card card-hover reveal p-4 md:p-5" style={{ ['--i' as string]: i + 1 }}>
            <div className="flex items-center justify-between"><p className="text-xs font-semibold text-muted md:text-sm">{k.label}</p>{d.empty ? null : <Delta v={k.delta} />}</div>
            <p className="font-display mt-2 text-3xl font-extrabold md:text-4xl"><CountUp to={k.value} suffix={k.suffix} /></p>
            <div className="mt-2"><Sparkline data={k.data.some((x) => x > 0) ? k.data : k.data.map(() => 0)} color={k.color} /></div>
            <p className="mt-1 text-[11px] text-muted">Last 14 days</p>
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="card reveal p-5 md:p-6" style={{ ['--i' as string]: 5 }}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="font-display text-lg font-bold">Campaign performance</h3><p className="text-sm text-muted">Last 14 days, India time</p></div>
              <Button asChild variant="soft" size="sm"><Link href="/analytics">Open analytics <ArrowRight className="size-4" /></Link></Button>
            </div>
            {d.empty ? (
              <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-center"><Send className="size-6 text-muted" /><p className="text-sm font-semibold">Nothing sent yet</p><p className="max-w-xs text-xs text-muted">Send your first campaign and the sent, delivered and read lines will fill in here.</p></div>
            ) : <PerformanceChart data={d.days} />}
          </section>

          <section className="card reveal p-5 md:p-6" style={{ ['--i' as string]: 6 }}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-display flex items-center gap-2 text-lg font-bold"><CalendarClock className="size-5 text-indigo" />Scheduled campaigns</h3><Button asChild variant="soft" size="sm"><Link href="/campaigns"><Plus className="size-4" />New</Link></Button></div>
            {d.scheduled.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">Nothing is scheduled. Pick a date when you create a bulk send and it shows up here.</p> : (
              <ul className="flex flex-col gap-2">
                {d.scheduled.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card2 p-3">
                    <span className="grad-bg flex size-10 items-center justify-center rounded-xl text-white"><Send className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{s.name}</span><span className="block truncate text-xs text-muted">{s.when}{s.template ? <> · <span className="font-mono">{s.template}</span></> : null}</span></span>
                    <span className="rounded-full bg-indigo/10 px-3 py-1 text-xs font-bold text-indigo tabular">{s.audience.toLocaleString('en-IN')} people</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="card reveal p-5" style={{ ['--i' as string]: 5 }}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-display flex items-center gap-2 text-lg font-bold"><MessageCircle className="size-5 text-brand" />Live chats</h3><Link href="/chats" className="text-sm font-semibold text-brand">Open</Link></div>
            {d.chats.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">No conversations yet. When a customer replies, it appears here.</p> : (
              <ul className="flex flex-col">
                {d.chats.map((c) => (
                  <li key={c.id}>
                    <Link href="/chats" className="flex min-h-14 items-center gap-3 rounded-xl px-2 hover:bg-ink/5">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-bold text-brand">{c.name.replace(/[^A-Za-z\u0900-\u097F ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '#'}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.name}</span><span className="block truncate text-xs text-muted">{c.preview || 'No messages yet'}</span></span>
                      <span className="flex flex-col items-end gap-1 text-[11px] text-muted">{c.ago}{c.unread ? <span className="grad-bg rounded-full px-1.5 font-bold text-white">{c.unread}</span> : null}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card reveal p-5" style={{ ['--i' as string]: 6 }}>
            <div className="mb-2 flex items-center justify-between"><h3 className="font-display text-lg font-bold">Getting started</h3><span className="text-xs font-semibold text-muted">{doneCount} of {d.steps.length}</span></div>
            <div className="mb-2 h-2 overflow-hidden rounded-full bg-line"><div className="grad-bg h-full rounded-full transition-all duration-1000" style={{ width: `${(doneCount / d.steps.length) * 100}%` }} /></div>
            <ul>
              {d.steps.map((s) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex min-h-11 items-center gap-3 text-sm">
                    {s.done ? <CheckCircle2 className="size-5 text-brand" /> : <Circle className="size-5 text-muted" />}
                    <span className={s.done ? 'text-muted line-through' : 'font-semibold'}>{s.label}</span>
                    {!s.done ? <ArrowRight className="ml-auto size-4 text-brand" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

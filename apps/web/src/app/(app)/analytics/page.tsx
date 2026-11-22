import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart3, Clock, IndianRupee, MailX, Send, UserMinus } from 'lucide-react';
import { PerformanceChart } from '@/components/dashboard/performance-chart';
import { cn } from '@/lib/utils';
import { requireCtx } from '@/lib/session';
import { getAnalytics, type Range } from './actions';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

const RANGES: Range[] = [7, 30, 90];
const n = (v: number) => v.toLocaleString('en-IN');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—');
const hour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const r = (RANGES.find((x) => String(x) === sp.range) ?? 30) as Range;
  const a = await getAnalytics(r);
  const canManage = ['owner', 'admin'].includes((await requireCtx()).role);
  const t = a.totals;
  const funnel = [
    { k: 'Sent', v: t.sent, c: 'bg-indigo' },
    { k: 'Delivered', v: t.delivered, c: 'bg-cyan-500' },
    { k: 'Read', v: t.read, c: 'bg-brand' },
    { k: 'Replied', v: t.replied, c: 'bg-amber' },
  ];
  const maxHour = Math.max(1, ...a.hours.map((h) => h.sent));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-display text-2xl font-extrabold">Analytics</h2><p className="text-sm text-muted">What your messages did, in India time.</p></div>
        <nav className="flex gap-1 rounded-full border border-line bg-card2 p-1" aria-label="Date range">
          {RANGES.map((x) => <Link key={x} href={`/analytics?range=${x}`} className={cn('flex min-h-9 items-center rounded-full px-4 text-sm font-semibold', x === r ? 'grad-bg text-white' : 'text-muted hover:text-ink')}>{x} days</Link>)}
        </nav>
      </div>

      {a.empty ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center"><BarChart3 className="size-9 text-muted" /><p className="font-display text-lg font-bold">No activity in the last {r} days</p><p className="max-w-sm text-sm text-muted">Send a campaign or get a reply and this page fills in with delivery, reading and cost figures.</p>{canManage ? <Link href="/campaigns" className="grad-bg mt-1 inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-white">Create campaign</Link> : null}</div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Totals">
            {[
              ['Sent', n(t.sent), `${n(t.skipped)} skipped`],
              ['Delivered', pct(t.delivered, t.sent), `${n(t.delivered)} people`],
              ['Read', pct(t.read, t.sent), `${n(t.read)} people`],
              ['Replied', pct(t.replied, t.sent), `${n(t.replied)} people`],
              ['Customer messages', n(t.inbound), 'received in total'],
            ].map(([k, v, s]) => <article key={k} className="card p-4"><p className="text-xs font-semibold text-muted">{k}</p><p className="font-display mt-1 text-3xl font-extrabold tabular">{v}</p><p className="text-xs text-muted">{s}</p></article>)}
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="card p-5 md:p-6">
              <h3 className="font-display text-lg font-bold">Sent, delivered and read</h3>
              <p className="mb-3 text-sm text-muted">Per day, last {r} days</p>
              {t.sent === 0 ? <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">No campaign messages in this period.</p> : <PerformanceChart data={a.days} />}
            </section>
            <section className="card p-5">
              <h3 className="font-display text-lg font-bold">From send to reply</h3>
              <ul className="mt-3 flex flex-col gap-3">
                {funnel.map((f) => (
                  <li key={f.k}>
                    <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{f.k}</span><span className="tabular text-muted">{n(f.v)} · {pct(f.v, t.sent)}</span></div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-line"><div className={cn('h-full rounded-full', f.c)} style={{ width: `${t.sent ? Math.max(2, Math.round((f.v / t.sent) * 100)) : 0}%` }} /></div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="grid gap-3 sm:grid-cols-3">
            <article className="card flex items-start gap-3 p-4"><IndianRupee className="mt-0.5 size-5 text-brand" /><div><p className="text-xs font-semibold text-muted">Estimated Meta charges</p><p className="font-display text-2xl font-extrabold tabular">{a.spendLabel}</p><p className="text-xs text-muted">{n(a.billableMessages)} charged messages, incl. 18% GST. Your Meta invoice is the final figure.</p></div></article>
            <article className="card flex items-start gap-3 p-4"><UserMinus className="mt-0.5 size-5 text-rose" /><div><p className="text-xs font-semibold text-muted">New opt-outs</p><p className="font-display text-2xl font-extrabold tabular">{n(t.newOptOuts)}</p><p className="text-xs text-muted">{t.sent ? `${pct(t.newOptOuts, t.sent)} of people messaged. ` : ''}{n(t.optedOut)} already-opted-out people were skipped.</p></div></article>
            <article className="card flex items-start gap-3 p-4"><Clock className="mt-0.5 size-5 text-indigo" /><div><p className="text-xs font-semibold text-muted">Best time to send</p>{a.bestHour ? <><p className="font-display text-2xl font-extrabold">{a.bestHour.label}</p><p className="text-xs text-muted">{a.bestHour.readPct}% read, from {n(a.bestHour.sent)} messages.</p></> : <p className="mt-1 text-sm text-muted">Needs at least two send hours with 20 or more messages each.</p>}</div></article>
          </section>

          {a.hours.length ? (
            <section className="card p-5 md:p-6">
              <h3 className="font-display text-lg font-bold">Read rate by hour sent</h3>
              <p className="mb-3 text-sm text-muted">Bar height is how many you sent; the number is the share who read it.</p>
              <div className="flex h-36 items-end gap-1 overflow-x-auto" role="img" aria-label="Read rate by hour of day">
                {a.hours.map((h) => (
                  <div key={h.hour} className="flex min-w-8 flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] font-semibold tabular text-muted">{h.sent >= 5 ? `${Math.round(h.readPct)}%` : ''}</span>
                    <div className="w-full rounded-t-md bg-brand/70" style={{ height: `${Math.max(4, Math.round((h.sent / maxHour) * 100))}px` }} title={`${hour(h.hour)}: ${n(h.sent)} sent`} />
                    <span className="text-[10px] text-muted">{hour(h.hour)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="card overflow-hidden">
            <div className="p-5 pb-3"><h3 className="font-display text-lg font-bold">Your campaigns</h3><p className="text-sm text-muted">Newest first</p></div>
            {a.campaigns.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No campaigns in this period.</p> : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-card2 text-left text-xs text-muted"><tr>{['Name', 'Date', 'Sent', 'Delivered', 'Read', 'Replied', 'Not delivered', 'Est. cost'].map((h, i) => <th key={h} className={cn('px-4 py-2 font-semibold', i > 1 && 'text-right')}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {a.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3"><p className="font-semibold">{c.name}</p>{c.template ? <p className="font-mono text-[11px] text-muted">{c.template}</p> : null}</td>
                        <td className="px-4 py-3 text-muted">{c.at}</td>
                        <td className="px-4 py-3 text-right tabular">{n(c.sent)}</td>
                        <td className="px-4 py-3 text-right tabular">{n(c.delivered)} <span className="text-xs text-muted">{c.deliveredPct}%</span></td>
                        <td className="px-4 py-3 text-right tabular">{n(c.read)} <span className="text-xs text-muted">{c.readPct}%</span></td>
                        <td className="px-4 py-3 text-right tabular">{n(c.replied)} <span className="text-xs text-muted">{c.replyPct}%</span></td>
                        <td className="px-4 py-3 text-right tabular">{n(c.failed)}</td>
                        <td className="px-4 py-3 text-right tabular">{c.costLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card p-5 md:p-6">
            <h3 className="font-display flex items-center gap-2 text-lg font-bold"><MailX className="size-5 text-rose" />Why messages did not arrive</h3>
            {a.reasons.length === 0 && t.failed + t.capped === 0 ? <p className="mt-2 text-sm text-muted">Nothing failed in this period.</p> : (
              <ul className="mt-3 flex flex-col gap-2">
                {t.capped ? <li className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2 text-sm"><span>Meta limited promotional messages to these people for now</span><strong className="tabular">{n(t.capped)}</strong></li> : null}
                {a.reasons.filter((x) => x.code !== 131049).map((x) => <li key={x.code} className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2 text-sm"><span>{x.text}</span><strong className="tabular">{n(x.count)}</strong></li>)}
              </ul>
            )}
          </section>
          <p className="flex items-center gap-2 text-xs text-muted"><Send className="size-3.5" />Figures come from delivery reports from WhatsApp. Late reports can still change recent days.</p>
        </>
      )}
    </div>
  );
}

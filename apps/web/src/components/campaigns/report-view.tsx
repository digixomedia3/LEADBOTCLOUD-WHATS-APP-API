'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, FlaskConical, Info, Loader2, MousePointerClick, Target } from 'lucide-react';
import { inr } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { AbTestCard } from '@/components/campaigns/ab-test-card';
import { cn } from '@/lib/utils';
import { loadRecipients, retargetFrom, type RetargetOp } from '@/app/(app)/campaigns/[id]/actions';
import type { CampaignReportData, RecipientRow, ResultFilter } from '@/lib/core/campaign-report';

type Page = { rows: RecipientRow[]; total: number; page: number; pages: number };
const FILTERS: [ResultFilter, string][] = [['all', 'Everyone'], ['replied', 'Replied'], ['read', 'Read'], ['delivered', 'Delivered'], ['sent', 'Sent'], ['failed', 'Failed'], ['capped', 'Held back'], ['skipped', 'Skipped'], ['waiting', 'Waiting']];
const STATE_LABEL: Record<string, string> = { queued: 'Waiting', retry_wait: 'Retrying', sent: 'Sent', delivered: 'Delivered', read: 'Read', replied: 'Replied', failed: 'Failed', skipped: 'Skipped', capped: 'Held back' };
const STATE_TONE: Record<string, string> = { replied: 'bg-brand/15 text-brand', read: 'bg-indigo/15 text-indigo', delivered: 'bg-ink/10', sent: 'bg-ink/10', failed: 'bg-red-500/10 text-red-600', skipped: 'bg-amber/15 text-amber', capped: 'bg-amber/15 text-amber', queued: 'bg-ink/5 text-muted', retry_wait: 'bg-ink/5 text-muted' };
const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const num = (n: number) => n.toLocaleString('en-IN');

export function ReportView({ report: r, initial, canExport }: { report: CampaignReportData; initial: Page; canExport: boolean }) {
  const [rt, setRt] = useState<{ ok: boolean; text: string; groupId?: string } | null>(null);
  const retarget = (op: RetargetOp) => start(async () => {
    setRt(null);
    const x = await retargetFrom(r.id, op);
    setRt(x.ok ? { ok: true, text: `Saved “${x.name}” (${x.people} ${x.people === 1 ? 'person' : 'people'} right now). Only people who agreed to messages are sent to.`, groupId: x.groupId } : { ok: false, text: x.error });
  });
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [page, setPage] = useState<Page>(initial);
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const go = (f: ResultFilter, p: number) => start(async () => {
    setErr('');
    const d = await loadRecipients(r.id, f, p);
    if (!d) { setErr('Could not load this list. Try again.'); return; }
    setFilter(f); setPage(d);
  });
  const top = r.funnel[0]!.count || 1;
  const maxHour = Math.max(1, ...r.sendsByHour.map((h) => h.count));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/campaigns" className="mb-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-brand"><ArrowLeft className="size-4" />All campaigns</Link>
        <h2 className="font-display text-2xl font-extrabold">{r.name}</h2>
        <p className="text-sm text-muted">{r.template ?? 'Template deleted'} · {r.groups.join(', ') || 'No group'} · {r.startedAt ? `started ${ist(r.startedAt)}` : r.scheduledAt ? `scheduled ${ist(r.scheduledAt)}` : r.status}</p>
      </div>

      {r.simulated ? <p className="flex items-center gap-2 rounded-xl bg-amber/10 p-3 text-sm text-amber"><FlaskConical className="size-4 shrink-0" />These are simulated test results. Nothing was sent to WhatsApp.</p> : null}
      {r.pauseReason ? <p className="flex items-center gap-2 rounded-xl bg-amber/10 p-3 text-sm text-amber"><AlertTriangle className="size-4 shrink-0" />This campaign is paused: {r.pauseReason.replace(/_/g, ' ')}.</p> : null}

      {/* Funnel */}
      <section className="card p-5" aria-label="Funnel">
        <h3 className="font-display text-lg font-bold">What happened to your audience</h3>
        <ol className="mt-4 flex flex-col gap-3">
          {r.funnel.map((s, i) => (
            <li key={s.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold">{s.label}</span>
                <span className="flex items-baseline gap-2 tabular-nums"><strong>{num(s.count)}</strong>{s.ofPrevious !== null && i > 0 ? <span className="text-xs text-muted">{s.ofPrevious}% of {i === 1 ? 'people messaged' : r.funnel[i - 1]!.label.toLowerCase()}</span> : null}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-ink/10" role="img" aria-label={`${s.label}: ${s.count} of ${r.funnel[0]!.count}`}>
                <div className="grad-bg h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(s.count > 0 ? 1.5 : 0, Math.round((s.count / top) * 1000) / 10)}%` }} />
              </div>
            </li>))}
        </ol>
        {r.clicks ? (
          <div className="mt-4 rounded-xl bg-card2 p-3 text-sm" aria-label="Link clicks">
            <p className="flex flex-wrap items-baseline gap-x-2"><MousePointerClick className="size-4 self-center text-brand" /><strong className="tabular-nums">{num(r.clicks.people)}</strong> {r.clicks.people === 1 ? 'person' : 'people'} clicked the link{r.clicks.ofDelivered !== null ? <span className="text-xs text-muted">{r.clicks.ofDelivered}% of people messaged</span> : null}</p>
            <p className="mt-1 break-all text-xs text-muted">Opens {r.clicks.destination}. {r.clicks.total > r.clicks.people ? `${num(r.clicks.total)} clicks in total (some people clicked more than once). ` : ''}{r.clicks.botVisits ? `${num(r.clicks.botVisits)} visits from link previews and security scanners were not counted.` : ''}</p>
          </div>) : null}
        <p className="mt-4 text-xs text-muted">Each step counts only people who got through the one before. “Read” and “Replied” depend on the customer’s own WhatsApp settings: people who turn off read receipts show as delivered.</p>
      </section>

      {r.abTest ? <AbTestCard ab={r.abTest} /> : null}

      {canExport ? (
        <section className="card p-5" aria-label="Retarget">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Target className="size-5 text-brand" />Send a follow-up</h3>
          <p className="mt-1 text-sm text-muted">Save a group from this campaign, then pick it in a new campaign. Only people who agreed to messages are ever sent to.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {([['not_read', 'Did not read it'], ['not_replied', 'Did not reply'], ['replied', 'Replied'], ...(r.clicks ? ([['clicked', 'Clicked the link'], ['not_clicked', 'Did not click']] as [RetargetOp, string][]) : []), ['failed', 'Not delivered']] as [RetargetOp, string][]).map(([op, label]) => <Button key={op} type="button" size="sm" variant="outline" disabled={pending} onClick={() => retarget(op)}>{label}</Button>)}
          </div>
          {rt ? <p role={rt.ok ? 'status' : 'alert'} className={cn('mt-3 text-sm', rt.ok ? 'text-brand' : 'text-rose')}>{rt.text}{rt.ok ? <> <Link href="/campaigns" className="font-semibold underline">Start a new campaign</Link></> : null}</p> : null}
        </section>) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5" aria-label="Where everyone ended up">
          <h3 className="font-display text-lg font-bold">Where everyone ended up</h3>
          <ul className="mt-3 divide-y divide-line text-sm">{r.outcomes.filter((o) => o.count > 0).map((o) => <li key={o.label} className="flex justify-between py-2"><span>{o.label}</span><strong className="tabular-nums">{num(o.count)}</strong></li>)}</ul>
          {r.reasons.length ? (
            <>
              <h4 className="mt-5 text-sm font-bold">Why some were not messaged</h4>
              <ul className="mt-2 divide-y divide-line text-sm">{r.reasons.map((x) => <li key={x.state + x.reason} className="flex justify-between gap-3 py-2"><span className="min-w-0">{x.reason}<span className="ml-2 text-xs text-muted">{STATE_LABEL[x.state]}</span></span><strong className="tabular-nums">{num(x.count)}</strong></li>)}</ul>
            </>) : null}
        </section>

        <section className="card p-5" aria-label="Cost">
          <h3 className="font-display text-lg font-bold">Cost</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">Estimated before sending</dt><dd className="text-xl font-extrabold tabular-nums">{inr(r.estCostPaise)}</dd></div>
            <div><dt className="text-muted">Billable messages so far</dt><dd className="text-xl font-extrabold tabular-nums">{r.simulated ? '—' : num(r.billed.billableMessages)}</dd></div>
          </dl>
          {!r.simulated && r.billed.lines.length ? (
            <table className="mt-4 w-full text-sm"><caption className="sr-only">Billable messages by category</caption>
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5 font-semibold">Category</th><th className="py-1.5 text-right font-semibold">Messages</th><th className="py-1.5 text-right font-semibold">Estimate</th></tr></thead>
              <tbody>{r.billed.lines.map((l) => <tr key={l.category} className="border-b border-line"><td className="py-1.5 capitalize">{l.category}</td><td className="py-1.5 text-right tabular-nums">{num(l.messages)}</td><td className="py-1.5 text-right tabular-nums">{l.amountPaise === null ? 'No rate' : inr(l.amountPaise)}</td></tr>)}
                <tr><td className="pt-2 text-muted" colSpan={2}>GST {18}%</td><td className="pt-2 text-right tabular-nums">{inr(r.billed.gstPaise)}</td></tr>
                <tr className="font-bold"><td className="pt-1" colSpan={2}>Total</td><td className="pt-1 text-right tabular-nums">{inr(r.billed.totalPaise)}</td></tr></tbody>
            </table>) : null}
          <p className="mt-3 flex gap-2 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" />{r.simulated ? 'Test mode: nothing was charged.' : `${r.billed.awaitingPricing ? `Meta has not reported the charge for ${r.billed.awaitingPricing} message${r.billed.awaitingPricing === 1 ? '' : 's'} yet. It arrives with delivery receipts, so this number can grow. ` : ''}This is our estimate of what Meta charges, using the rates in our price table. Meta bills you directly, so check your Meta statement for the exact amount.${r.billed.unpriced ? ` ${r.billed.unpriced} messages are in a category we have no rate for and are not priced.` : ''}`}</p>
        </section>
      </div>

      {r.offer.code ? <p className="card p-4 text-sm">Offer code <code className="rounded bg-ink/5 px-1.5 py-0.5 font-bold">{r.offer.code}</code>{r.offer.endsAt ? <> · offer ends {ist(r.offer.endsAt)}</> : null}</p> : null}

      {r.sendsByHour.length > 1 ? (
        <section className="card p-5" aria-label="When messages went out">
          <h3 className="font-display text-lg font-bold">When messages went out</h3>
          <div className="mt-4 flex h-24 items-end gap-1" role="img" aria-label="Messages sent per hour">{r.sendsByHour.map((h) => <div key={h.hour} title={`${h.hour}: ${h.count}`} className="grad-bg min-w-1 flex-1 rounded-t" style={{ height: `${Math.max(4, (h.count / maxHour) * 100)}%` }} />)}</div>
          <p className="mt-2 flex justify-between text-xs text-muted"><span>{r.sendsByHour[0]!.hour}</span><span>{r.sendsByHour[r.sendsByHour.length - 1]!.hour} (IST)</span></p>
        </section>) : null}

      {/* People */}
      <section className="card p-5" aria-label="People">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold">People</h3>
          {canExport ? <Button asChild variant="outline" size="sm"><a href={`/campaigns/${r.id}/export?result=${filter}`}><Download className="size-4" />Download {filter === 'all' ? 'everyone' : FILTERS.find(([k]) => k === filter)![1].toLowerCase()} (CSV)</a></Button> : null}
        </div>
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter people">
          {FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} onClick={() => go(k, 1)} className={cn('min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold', filter === k ? 'bg-brand text-white' : 'bg-ink/5 hover:bg-ink/10')}>{l}</button>)}
        </div>
        {err ? <p role="alert" className="mt-3 text-sm text-red-600">{err}</p> : null}
        <div className={cn('mt-3 overflow-x-auto', pending && 'opacity-60')}>
          {page.rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">Nobody here.</p> : (
            <table className="w-full min-w-[30rem] text-sm"><caption className="sr-only">People in this campaign</caption>
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pr-3 font-semibold">Name</th><th className="py-2 pr-3 font-semibold">Phone</th><th className="py-2 pr-3 font-semibold">Result</th><th className="py-2 font-semibold">Why / when</th></tr></thead>
              <tbody>{page.rows.map((p, i) => <tr key={p.phone + i} className="border-b border-line"><td className="py-2 pr-3">{p.name || <span className="text-muted">No name</span>}</td><td className="py-2 pr-3 tabular-nums">{p.phone}</td><td className="py-2 pr-3"><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', STATE_TONE[p.state])}>{STATE_LABEL[p.state] ?? p.state}</span></td><td className="py-2 text-muted">{p.reason ?? ist(p.sentAt)}</td></tr>)}</tbody>
            </table>)}
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted">{num(page.total)} {page.total === 1 ? 'person' : 'people'}{page.pages > 1 ? ` · page ${page.page} of ${page.pages}` : ''}</span>
          <span className="flex gap-1">
            <Button variant="outline" size="icon" aria-label="Previous page" disabled={pending || page.page <= 1} onClick={() => go(filter, page.page - 1)}><ChevronLeft className="size-4" /></Button>
            <Button variant="outline" size="icon" aria-label="Next page" disabled={pending || page.page >= page.pages} onClick={() => go(filter, page.page + 1)}>{pending ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}</Button>
          </span>
        </div>
      </section>
    </div>
  );
}

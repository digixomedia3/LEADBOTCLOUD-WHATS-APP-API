'use client';

import { useState, useTransition } from 'react';
import { Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { endGrant, grantPlan, loadPlan, type PlanInfo } from '@/app/(admin)/admin/actions';

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }) : '');

/** Plan and billing for staff: what the workspace has, where it comes from (paid or a free grant), and giving a free plan for a limited time. */
export function PlanCard({ id, initial }: { id: string; initial: PlanInfo }) {
  const [info, setInfo] = useState(initial);
  const [plan, setPlan] = useState('pro'); const [days, setDays] = useState(30); const [reason, setReason] = useState('');
  const [endReason, setEndReason] = useState(''); const [ending, setEnding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, start] = useTransition();
  const refresh = async () => { const r = await loadPlan(id); if (r.ok && r.data) setInfo(r.data); };
  const paying = !!info.paid;
  const ok = reason.trim().length >= 5 && days >= 1 && days <= 365;
  return (
    <section className="card flex flex-col gap-3 p-4" aria-label="Plan and billing">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold"><Gift className="size-5 text-indigo" aria-hidden />Plan and billing</h2>
      {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'rounded-xl bg-brand/10 px-3 py-2 text-sm text-brand' : 'rounded-xl bg-rose/10 px-3 py-2 text-sm text-rose'}>{msg.text}</p> : null}
      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1.5 text-sm">
        <dt className="text-muted">Plan right now</dt><dd className="font-semibold">{cap(info.effective)}</dd>
        <dt className="text-muted">Pays for</dt><dd>{info.paid ? `${cap(info.paid.plan)} (${info.paid.status}${info.paid.currentEnd ? `, renews ${day(info.paid.currentEnd)}` : ''}${info.paid.cancelAtCycleEnd ? ', cancels at the end of the period' : ''})` : 'Nothing: no paid subscription'}</dd>
        <dt className="text-muted">Free grant</dt><dd>{info.grant ? <span className="break-words">{cap(info.grant.plan)} until {day(info.grant.until)}{info.grant.live ? '' : ' (ended)'}. “{info.grant.reason}” by {info.grant.by ?? 'staff'}</span> : 'None'}</dd>
      </dl>
      {info.grant ? (
        ending ? (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <label className="text-xs font-semibold text-muted" htmlFor="end-grant-reason">Why end it early? (5 to 200 characters, kept in the log)</label>
            <Input id="end-grant-reason" value={endReason} maxLength={200} onChange={(e) => setEndReason(e.target.value)} />
            <div className="flex gap-2">
              <Button disabled={busy || endReason.trim().length < 5} onClick={() => start(async () => { const r = await endGrant(id, endReason.trim()); if (!r.ok) { setMsg({ ok: false, text: r.error }); return; } setMsg({ ok: true, text: `Grant ended. The workspace is now on ${cap(r.data.plan ?? 'free')}.` }); setEnding(false); setEndReason(''); await refresh(); })}>End grant now</Button>
              <Button variant="outline" disabled={busy} onClick={() => setEnding(false)}>Keep it</Button>
            </div>
          </div>) : <div><Button variant="outline" size="sm" onClick={() => setEnding(true)}>End grant early</Button></div>
      ) : null}
      {paying ? <p className="rounded-xl bg-ink/5 p-3 text-sm text-muted">This workspace pays for its plan, so it cannot be given a free one. Its plan follows its subscription: change it through billing.</p> : (
        <form className="flex flex-col gap-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (!ok) return; start(async () => { const r = await grantPlan(id, plan, days, reason.trim()); if (!r.ok) { setMsg({ ok: false, text: r.error }); return; } setMsg({ ok: true, text: `${cap(plan)} given until ${day(r.data.until)}. It ends by itself.` }); setReason(''); await refresh(); }); }}>
          <p className="text-sm font-semibold">Give a free plan for a limited time</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plan"><Select value={plan} onChange={(e) => setPlan(e.target.value)}>{['starter', 'growth', 'pro'].map((p) => <option key={p} value={p}>{cap(p)}</option>)}</Select></Field>
            <Field label="For how many days (1 to 365)"><Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
          </div>
          <Field label="Reason (5 to 200 characters, shown to the customer in their Activity log)"><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pilot customer, ticket 123" /></Field>
          <div><Button type="submit" disabled={!ok || busy}>{busy ? 'Saving…' : `Give ${cap(plan)} for ${days || '…'} days`}</Button></div>
        </form>)}
      <p className="text-xs text-muted">A grant never charges or refunds anything. It ends by itself on the date shown, and the workspace goes back to what it pays for. Customers cannot give themselves a grant.</p>
    </section>
  );
}

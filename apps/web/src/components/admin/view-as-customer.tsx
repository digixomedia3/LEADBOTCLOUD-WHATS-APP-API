'use client';

import { useState, useTransition } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startView, type ViewRow } from '@/app/(admin)/admin/actions';

const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');

/** Staff: look at a customer's workspace exactly as they see it, read-only, for 30 minutes. A reason is required; the customer sees the entry in their Activity log. */
export function ViewAsCustomer({ tenantId, tenantName, closed, history }: { tenantId: string; tenantName: string; closed: boolean; history: ViewRow[] }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, start] = useTransition();
  const ok = reason.trim().length >= 5;
  return (
    <section className="card p-5" aria-label="View as customer">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Eye className="size-5 text-indigo" aria-hidden />View as customer</h3>
      <p className="mt-1 text-sm text-muted">See {tenantName} exactly as its owner does, for 30 minutes. It is read-only: nothing can be changed, sent or marked as read. Your name and the reason below are written to their Activity log.</p>
      {closed ? <p className="mt-3 text-sm text-muted">This workspace has been closed and its data erased, so there is nothing to view.</p> : (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (!ok) return; setErr(''); start(async () => { const r = await startView(tenantId, reason.trim()); if (!r.ok) { setErr(r.error); return; } window.location.assign('/dashboard'); }); }}>
          <label className="text-xs font-semibold text-muted" htmlFor="view-reason">Why do you need to look? (5 to 300 characters, for example “Support ticket 4821: campaign stuck”)</label>
          <textarea id="view-reason" value={reason} maxLength={300} rows={2} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-line bg-card p-2 text-sm" />
          {err ? <p className="text-sm text-rose" role="alert">{err}</p> : null}
          <div><Button type="submit" disabled={!ok || busy}>{busy ? 'Starting…' : 'Start 30-minute view'}</Button></div>
        </form>)}
      {history.length ? (
        <div className="mt-4"><p className="text-xs font-semibold text-muted">Recent views of this workspace</p>
          <ul className="mt-1 divide-y divide-line text-sm">{history.map((h) => (
            <li key={h.id} className="py-2"><p className="break-words"><strong>{h.staff}</strong> · {when(h.startedAt)}{h.endedAt ? ` to ${when(h.endedAt)}` : new Date(h.expiresAt).getTime() > Date.now() ? ' · open now' : ' · timed out'}</p><p className="break-words text-xs text-muted">{h.reason}</p></li>))}
          </ul></div>) : null}
    </section>
  );
}

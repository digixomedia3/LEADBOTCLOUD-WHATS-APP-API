'use client';

import { useState, useTransition } from 'react';
import { BellRing, FlaskConical, IndianRupee, Loader2, Plus } from 'lucide-react';
import { formatPhone } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { addRenewal, cancelRenewal, listRenewals, markPaid, remindNow, type RenewalRow } from '@/app/(app)/renewals/actions';
import { inr } from '@/lib/cost';
import { cn } from '@/lib/utils';

type Data = Awaited<ReturnType<typeof listRenewals>>;
type Tab = 'due_soon' | 'overdue' | 'later' | 'renewed' | 'all';
const TABS: [Tab, string][] = [['due_soon', 'Due in 7 days'], ['overdue', 'Overdue'], ['later', 'Later'], ['renewed', 'Renewed'], ['all', 'All']];

export function RenewalsView({ initial, contacts, canEdit }: { initial: Data; contacts: { id: string; label: string }[]; canEdit: boolean }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>('due_soon');
  const [add, setAdd] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [pending, start] = useTransition();
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };
  const refresh = async () => setData(await listRenewals());
  const shown = data.rows.filter((r) => tab === 'all' || r.bucket === tab);
  const k = data.kpi;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError('');
    start(async () => {
      const r = await addRenewal({ contactId: String(f.get('contactId')), planName: String(f.get('planName')), amountRupees: Number(f.get('amount')), dueOn: String(f.get('dueOn')) });
      if (!r.ok) { setError(r.error); return; }
      setAdd(false); await refresh(); flash('Renewal added.');
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="font-display text-2xl font-extrabold">Renewals</h2><p className="text-sm text-muted">Never lose a customer to a forgotten due date. Track plans, remind, and see money recovered.</p></div>
        {canEdit ? <Button onClick={() => { setError(''); setAdd(true); }} disabled={contacts.length === 0}><Plus className="size-4" />Add renewal</Button> : null}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Due in 7 days', String(k.dueSoon), inr(k.dueSoonPaise), 'text-amber'], ['Overdue', String(k.overdue), inr(k.overduePaise), 'text-rose'], ['Recovered this month', inr(k.recoveredPaise), `${k.renewedThisMonth} renewed`, 'text-brand'], ['Reminder cost', '₹1.02', 'per message incl. GST', 'text-muted']].map(([t, v, s, c]) => (
          <div key={t} className="card p-4"><p className="text-xs font-semibold text-muted">{t}</p><p className={cn('mt-1 font-display text-2xl font-extrabold tabular', c)}>{v}</p><p className="text-xs text-muted">{s}</p></div>))}
      </div>
      <p className="flex items-start gap-2 rounded-xl border border-dashed border-amber/50 bg-amber/5 p-3 text-sm"><FlaskConical className="mt-0.5 size-4 shrink-0 text-amber" /><span><strong>Test mode.</strong> “Remind” records the reminder here. Messages go out once your WhatsApp number is connected. Renewal reminders are Promotional messages, so Meta charges the Promotional rate.</span></p>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">{TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', tab === id ? 'grad-bg border-transparent text-white' : 'border-line bg-card text-muted')}>{l} <span className="tabular opacity-80">{id === 'all' ? data.rows.length : data.rows.filter((r) => r.bucket === id).length}</span></button>)}</div>

      {shown.length === 0 ? <div className="card flex flex-col items-center p-10 text-center"><BellRing className="mb-3 size-10 text-muted" /><p className="font-semibold">{data.rows.length === 0 ? 'No renewals yet' : 'Nothing in this list'}</p><p className="mt-1 max-w-sm text-sm text-muted">{contacts.length === 0 ? 'Add contacts first, then track their plans here.' : 'Add a customer’s plan and due date. We keep count for you.'}</p></div> : (
        <ul className="grid gap-3">{shown.map((r: RenewalRow) => (
          <li key={r.id} className="card flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1"><p className="truncate font-bold">{r.name ?? formatPhone(r.phone)}</p><p className="text-sm text-muted">{r.planName} · {inr(r.amountPaise)}</p></div>
            <div className="text-right text-sm"><p className={cn('font-bold', r.bucket === 'overdue' ? 'text-rose' : r.bucket === 'due_soon' ? 'text-amber' : '')}>{r.status === 'renewed' ? 'Renewed' : r.bucket === 'overdue' ? `${-r.daysLeft} days overdue` : r.daysLeft === 0 ? 'Due today' : `In ${r.daysLeft} days`}</p><p className="text-xs text-muted">{new Date(r.dueOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}{r.lastReminderAt ? ' · reminded' : ''}</p></div>
            {canEdit && r.status === 'active' ? <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const x = await remindNow(r.id); if (!x.ok) flash(x.error); else { await refresh(); flash('Reminder recorded (test mode).'); } })}><BellRing className="size-4" />Remind</Button>
              <Button size="sm" disabled={pending} onClick={() => start(async () => { const x = await markPaid(r.id); if (!x.ok) flash(x.error); else { await refresh(); flash('Marked as paid.'); } })}><IndianRupee className="size-4" />Paid</Button>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm('Cancel this renewal?')) start(async () => { await cancelRenewal(r.id); await refresh(); }); }}>Cancel</Button></div> : null}
          </li>))}</ul>)}

      <Modal open={add} onClose={() => setAdd(false)} title="Add a renewal">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormError>{error}</FormError>
          <Field label="Customer"><Select name="contactId" required defaultValue="">{<option value="" disabled>Choose a contact</option>}{contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
          <Field label="Plan name"><Input name="planName" required placeholder="Gold monthly" maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Amount (₹)"><Input name="amount" type="number" inputMode="decimal" min={0} step="0.01" required /></Field><Field label="Due date"><Input name="dueOn" type="date" required /></Field></div>
          <Button type="submit" disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Add renewal</Button>
        </form>
      </Modal>
      {toast ? <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg shadow-xl md:bottom-8">{toast}</div> : null}
    </div>
  );
}

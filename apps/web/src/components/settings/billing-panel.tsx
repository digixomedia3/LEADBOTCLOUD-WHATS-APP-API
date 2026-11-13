'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FileText, Loader2 } from 'lucide-react';
import { PLAN_LIMITS, planCharge, planRank, type PaidPlanId } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { cancelSubscription, changePlan, loadBilling, startCheckout, type BillingInfo } from '@/app/(app)/settings/billing-actions';
import { cn } from '@/lib/utils';

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const PLANS = ['free', 'starter', 'growth', 'pro'] as const;

export function BillingPanel() {
  const [b, setB] = useState<BillingInfo | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, start] = useTransition();
  const [which, setWhich] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = () => loadBilling().then(setB).catch(() => setErr('Could not load billing. Refresh the page.'));
  useEffect(() => { void refresh(); }, []);
  // Returning from Razorpay: the webhook may take a few seconds, so look again a few times.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('paid') !== '1') return;
    let n = 0; const t = setInterval(() => { void refresh(); if (++n >= 8) clearInterval(t); }, 3000);
    return () => clearInterval(t);
  }, []);

  if (!b) return <p className="text-sm text-muted">{err || 'Loading…'}</p>;
  const live = b.sub && ['active', 'pending', 'authenticated', 'halted', 'paused'].includes(b.sub.status);
  const label = PLAN_LIMITS[b.plan as 'free']?.label ?? b.plan;
  const over = b.usage.contacts > b.limits.contacts || b.usage.users > b.limits.users;

  const buy = (p: PaidPlanId) => { setErr(''); setNote(''); setWhich(p); start(async () => { const r = await startCheckout(p); if (r.ok) window.location.href = r.data.url; else { setErr(r.error); setWhich(''); } }); };
  const change = (p: PaidPlanId) => { setErr(''); setNote(''); setWhich(p); start(async () => { const r = await changePlan(p); setWhich(''); if (r.ok) { setNote(r.data.when === 'now' ? 'Plan changed. Razorpay charges the difference on your next bill.' : `Scheduled for the end of this period (${day(b.sub?.currentEnd ?? null)}). You keep your current plan until then.`); await refresh(); } else setErr(r.error); }); };
  const cancel = () => start(async () => { const r = await cancelSubscription(); setConfirmCancel(false); if (r.ok) { setNote(`Cancelled. You keep your plan until ${day(b.sub?.currentEnd ?? null)}, then move to Free. Nothing is deleted.`); await refresh(); } else setErr(r.error); });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-muted">Current plan</p>
          <p className="font-display text-xl font-extrabold">{label}</p>
          {b.sub && live ? (
            <p className="mt-0.5 text-xs text-muted">
              {b.sub.cancelAtCycleEnd ? `Cancelled. Ends ${day(b.sub.currentEnd)}.` : b.sub.status === 'pending' ? 'Last payment failed. Razorpay is retrying.' : b.sub.status === 'halted' ? 'Payment failed. Update your payment method.' : `Renews ${day(b.sub.currentEnd)}.`}
              {b.sub.pendingPlan ? ` Moves to ${PLAN_LIMITS[b.sub.pendingPlan as 'free']?.label} then.` : ''}
            </p>
          ) : b.sub?.status === 'created' ? <p className="mt-0.5 text-xs text-muted">A checkout was started but not paid. Choose a plan to try again.</p> : null}
        </div>
        {b.sub?.status === 'active' && !b.sub.cancelAtCycleEnd && b.isOwner ? <Button variant="ghost" onClick={() => setConfirmCancel(true)}>Cancel subscription</Button> : null}
      </div>

      {over ? (
        <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>You have {b.usage.contacts.toLocaleString('en-IN')} contacts and {b.usage.users} {b.usage.users === 1 ? 'user' : 'users'}; the {label} plan allows {b.limits.contacts.toLocaleString('en-IN')} and {b.limits.users}. Nothing is deleted, but you cannot add more until you upgrade or remove some.</p>
        </div>
      ) : null}
      {!b.enabled ? <p className="rounded-xl border border-line bg-surface-2 p-3 text-sm text-muted">Online payment is not switched on for this installation yet.</p> : null}
      {!b.isOwner ? <p className="text-sm text-muted">Only the workspace owner can change the plan.</p> : null}
      {err ? <FormError>{err}</FormError> : null}
      {note ? <p className="flex items-start gap-2 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{note}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {PLANS.map((id) => {
          const l = PLAN_LIMITS[id]; const cur = id === b.plan; const paid = id !== 'free';
          const c = paid ? planCharge(id as PaidPlanId) : null;
          const downgrade = paid && live && planRank(id) < planRank(b.plan);
          return (
            <div key={id} className={cn('card flex flex-col gap-2 p-4', cur && 'border-brand ring-2 ring-brand/30')}>
              <div className="flex items-baseline justify-between">
                <h3 className="font-display font-bold">{l.label}</h3>
                <p className="font-display text-xl font-extrabold">{c ? inr(c.basePaise) : '₹0'}<span className="text-xs font-medium text-muted">/mo</span></p>
              </div>
              <p className="text-sm text-muted">{l.users} {l.users === 1 ? 'user' : 'users'} · {l.contacts.toLocaleString('en-IN')} contacts</p>
              {c ? <p className="text-xs text-muted">+ {inr(c.gstPaise)} GST = {inr(c.totalPaise)} per month</p> : null}
              <div className="mt-auto pt-1">
                {cur ? <span className="text-sm font-semibold text-brand">Your plan</span>
                  : !paid ? null
                  : !b.isOwner || !b.enabled ? null
                  : live && b.sub?.status === 'active' ? <Button variant={downgrade ? 'outline' : 'primary'} disabled={busy} onClick={() => change(id as PaidPlanId)}>{busy && which === id ? <Loader2 className="size-4 animate-spin" /> : null}{downgrade ? 'Switch at period end' : 'Upgrade now'}</Button>
                  : live ? <span className="text-xs text-muted">Fix the payment issue first.</span>
                  : <Button disabled={busy} onClick={() => buy(id as PaidPlanId)}>{busy && which === id ? <Loader2 className="size-4 animate-spin" /> : null}Pay with Razorpay</Button>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">Prices exclude GST; 18% GST is added at checkout. Cards, UPI and netbanking via Razorpay. See the <Link href="/refunds" className="underline">refund and cancellation policy</Link>.</p>

      <section>
        <h3 className="mb-2 font-display font-bold">Invoices</h3>
        {b.invoices.length === 0 ? <p className="text-sm text-muted">No invoices yet. A GST invoice appears here after each payment.</p> : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {b.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-muted" /><span className="truncate font-medium">{i.number}</span><span className="hidden text-muted sm:inline">{day(i.issuedAt)}</span></span>
                <span className="flex items-center gap-3"><span>{inr(i.totalPaise)}</span><a className="text-brand underline" href={`/invoices/${i.id}`} target="_blank" rel="noreferrer">View</a></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel your subscription?">
        <p className="text-sm text-muted">You keep {label} until {day(b.sub?.currentEnd ?? null)}. After that the workspace moves to Free. Contacts, chats and campaigns are kept; you just cannot add beyond the Free limits. We do not refund the current period.</p>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep my plan</Button><Button disabled={busy} onClick={cancel}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Cancel at period end</Button></div>
      </Modal>
    </div>
  );
}

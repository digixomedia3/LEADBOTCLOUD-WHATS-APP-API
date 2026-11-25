'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Bell, CircleDollarSign, FileSpreadsheet, MessageSquare, ShieldCheck, Upload, Users } from 'lucide-react';
import { estimateCost } from '@/lib/cost';
import { cn } from '@/lib/utils';

const cost = estimateCost(2100, 'marketing');

function Window({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_30px_70px_-35px_rgba(10,20,50,0.55)]">
      <div className="flex items-center gap-1.5 border-b border-line bg-card2 px-3 py-2" aria-hidden="true"><span className="size-2.5 rounded-full bg-rose/70" /><span className="size-2.5 rounded-full bg-amber/70" /><span className="size-2.5 rounded-full bg-brand/70" /><span className="ml-3 truncate rounded-md bg-bg px-3 py-0.5 text-[11px] text-muted">{url}</span></div>
      <div className="p-4 sm:p-5">{children}</div>
      <figcaption className="border-t border-line px-4 py-2 text-[11px] text-muted">Sample data. Made-up names and numbers.</figcaption>
    </figure>
  );
}

function UploadPanel() {
  return (
    <Window url="app.leadbotcloud.com/contacts">
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3">
        <FileSpreadsheet className="size-9 shrink-0 text-[#047857]" />
        <div className="min-w-0"><p className="truncate text-sm font-semibold">march-customers.xlsx</p><p className="text-xs text-muted">3,000 rows. Hindi and English column names found.</p></div>
        <span className="ml-auto shrink-0 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-semibold lp-gtext">Checked</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-brand/10 p-4"><p className="font-display text-3xl font-semibold tabular-nums lp-gtext">2,953</p><p className="text-sm">ready to message</p></div>
        <div className="rounded-xl bg-amber/10 p-4"><p className="font-display text-3xl font-semibold tabular-nums lp-atext">47</p><p className="text-sm">skipped, with reasons</p></div>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-muted">
        <li className="flex justify-between gap-3"><span>The same number appears twice</span><span className="tabular-nums font-semibold text-ink">21</span></li>
        <li className="flex justify-between gap-3"><span>Not a valid mobile number</span><span className="tabular-nums font-semibold text-ink">18</span></li>
        <li className="flex justify-between gap-3"><span>Damaged by Excel (fix offered)</span><span className="tabular-nums font-semibold text-ink">8</span></li>
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card2 p-3 text-sm">
        <span className="font-semibold">Where did these people agree?</span>
        <span className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold">Order form · saved with today’s date</span>
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm font-semibold"><ArrowDownToLine className="size-4 text-muted" />Download the 47 skipped rows</p>
    </Window>
  );
}

function CostPanel() {
  return (
    <Window url="app.leadbotcloud.com/campaigns/new">
      <p className="text-xs font-medium text-muted">Review before sending</p>
      <p className="mt-1 font-display text-xl font-semibold">Festive offer · to Past buyers and Old enquiries</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-brand/10 p-4"><p className="font-display text-3xl font-semibold tabular-nums lp-gtext">2,100</p><p className="text-sm">will get it</p></div>
        <div className="rounded-xl bg-card2 p-4"><p className="font-display text-3xl font-semibold tabular-nums">900</p><p className="text-sm text-muted">skipped, listed in the report</p></div>
      </div>
      <dl className="mt-3 divide-y divide-line text-sm">
        <div className="flex justify-between py-2"><dt className="text-muted">2,100 × ₹0.8631</dt><dd className="font-semibold tabular-nums">{cost.baseLabel}</dd></div>
        <div className="flex justify-between py-2"><dt className="text-muted">GST 18%</dt><dd className="font-semibold tabular-nums">{cost.gstLabel}</dd></div>
        <div className="flex justify-between py-2.5 text-base"><dt className="font-semibold">Total, paid to Meta</dt><dd className="font-display text-xl font-semibold tabular-nums">{cost.totalLabel}</dd></div>
      </dl>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-brand/10 p-3 text-sm"><span className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 lp-gtext" />Spend cap ₹3,000: within limit</span><span className="rounded-lg bg-[var(--lp-wa)] px-3 py-1.5 text-xs font-semibold text-[#04221a]">Send to 2,100</span></div>
    </Window>
  );
}

function InboxPanel() {
  const rows = [
    { n: 'Ritika S.', m: 'Send me the link', t: '2 min', who: 'You', unread: 1 },
    { n: 'Arjun M.', m: 'Booked a demo for Monday', t: '14 min', who: 'Rahul', unread: 0 },
    { n: 'Sana P.', m: 'Are you open on Sunday?', t: '1 hr', who: 'Unassigned', unread: 1 },
  ];
  return (
    <Window url="app.leadbotcloud.com/chats">
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.n} className="flex items-center gap-3 py-3">
            <span className="grad-bg flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white">{r.n.slice(0, 1)}</span>
            <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className="truncate font-semibold">{r.n}</span><span className="shrink-0 text-xs text-muted">{r.t}</span></span><span className="block truncate text-sm text-muted">{r.m}</span></span>
            <span className="flex shrink-0 flex-col items-end gap-1"><span className="rounded-full bg-card2 px-2 py-0.5 text-[11px] font-semibold text-muted">{r.who}</span>{r.unread ? <span className="flex size-5 items-center justify-center rounded-full bg-[var(--lp-wa)] text-[11px] font-semibold text-[#04221a]">{r.unread}</span> : null}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2 rounded-xl bg-card2 p-3 text-sm text-muted"><MessageSquare className="size-4 shrink-0" />Private notes, assignment and quick replies for the whole team, in one inbox.</div>
    </Window>
  );
}

function RenewalPanel() {
  return (
    <Window url="app.leadbotcloud.com/renewals">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-amber/10 p-3"><p className="font-display text-xl font-semibold tabular-nums lp-atext sm:text-2xl">₹8,500</p><p className="text-[11px] sm:text-xs">due this week</p></div>
        <div className="rounded-xl bg-rose/10 p-3"><p className="font-display text-xl font-semibold tabular-nums text-rose sm:text-2xl">₹12,400</p><p className="text-[11px] sm:text-xs">overdue</p></div>
        <div className="rounded-xl bg-brand/10 p-3"><p className="font-display text-xl font-semibold tabular-nums lp-gtext sm:text-2xl">₹21,000</p><p className="text-[11px] sm:text-xs">renewed this month</p></div>
      </div>
      <ul className="mt-3 divide-y divide-line text-sm">
        {[['Aarav K.', 'Gym, monthly', 'Due Friday', '₹1,500'], ['Meera J.', 'Tuition, quarterly', 'Overdue 4 days', '₹6,000'], ['Imran S.', 'Internet, monthly', 'Due Saturday', '₹799']].map(([n, p, d, a]) => (
          <li key={n} className="flex items-center gap-3 py-2.5"><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{n}</span><span className="block truncate text-xs text-muted">{p} · {d}</span></span><span className="tabular-nums font-semibold">{a}</span><span className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold">Remind</span></li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-card2 p-3 text-sm"><CircleDollarSign className="size-4 shrink-0 text-muted" />Payment links through Razorpay<span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-semibold lp-atext">Soon</span></p>
    </Window>
  );
}

const TABS = [
  { id: 'upload', c: 'list', Icon: Upload, t: 'Bring your list in', d: 'Upload a file. Every row we cannot use is listed with the reason, and agreement is saved with the date.', Panel: UploadPanel },
  { id: 'cost', c: 'send', Icon: CircleDollarSign, t: 'See the cost, then send', d: 'Who gets it, who is skipped, and the total with GST. A spend cap stops the send if it would go over.', Panel: CostPanel },
  { id: 'inbox', c: 'reply', Icon: Users, t: 'Reply as a team', d: 'Replies land in one shared inbox with assignment and private notes.', Panel: InboxPanel },
  { id: 'renew', c: 'sale', Icon: Bell, t: 'Never miss a renewal', d: 'See who is due or overdue, remind them in one tap, mark the payment.', Panel: RenewalPanel },
] as const;

/** Four steps, each shown as the real screen drawn large enough to read. Auto-plays until the visitor takes over. */
export function HowTabs() {
  const [i, setI] = useState(0);
  const [manual, setManual] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setManual(true); }, []);

  const go = (n: number, user = true) => { setI(n); if (user) setManual(true); };
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); const n = (i + d + TABS.length) % TABS.length; go(n); refs.current[n]?.focus();
  };
  const Active = TABS[i]!.Panel;

  return (
    <div className="lp-tabs grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
      <div role="tablist" aria-label="How it works" onKeyDown={onKey} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {TABS.map((tb, n) => {
          const on = n === i;
          return (
            <button key={tb.id} ref={(el) => { refs.current[n] = el; }} role="tab" id={`tab-${tb.id}`} data-c={tb.c} aria-selected={on} aria-controls={`panel-${tb.id}`} tabIndex={on ? 0 : -1} onClick={() => go(n)}
              className={cn('relative shrink-0 overflow-hidden rounded-2xl border p-3.5 text-left transition lg:p-5', on ? 'bg-card shadow-lg' : 'border-line bg-card/60 hover:bg-card')}>
              <span className="flex items-center gap-3 text-[15px] font-semibold tracking-[-0.01em] lg:text-base"><span className="tab-ic flex size-9 shrink-0 items-center justify-center rounded-xl"><tb.Icon className="size-4.5" /></span>{tb.t}</span>
              <span className={cn('mt-2 hidden text-sm text-muted', on && 'lg:block')}>{tb.d}</span>
              {on && !manual ? <span key={`${i}-timer`} className="lp-timer absolute inset-x-0 bottom-0 h-1" onAnimationEnd={() => go((i + 1) % TABS.length, false)} /> : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${TABS[i]!.id}`} aria-labelledby={`tab-${TABS[i]!.id}`} className="min-w-0">
        <div key={TABS[i]!.id} className="animate-[pop_0.4s_cubic-bezier(0.2,0.8,0.2,1)_both]"><Active /></div>
        <p className="mt-4 text-sm text-muted lg:hidden">{TABS[i]!.d}</p>
      </div>
    </div>
  );
}


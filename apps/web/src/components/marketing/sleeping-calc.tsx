'use client';

import { useState } from 'react';
import { estimateCost, inr } from '@/lib/cost';

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

/**
 * "Sleeping list" calculator. Every number comes from the visitor's own inputs plus Meta's published India rate (via lib/cost).
 * It is an illustration, not a forecast, and says so on screen. No invented benchmarks.
 */
export function SleepingCalc() {
  const [contacts, setContacts] = useState(3000);
  const [agreed, setAgreed] = useState(70);
  const [order, setOrder] = useState(1500);
  const [buy, setBuy] = useState(1);

  const reach = Math.round((contacts * agreed) / 100);
  const cost = estimateCost(reach, 'marketing');
  const orders = (reach * buy) / 100;
  const revenue = orders * order;
  const multiple = cost.totalPaise > 0 ? revenue / (cost.totalPaise / 100) : 0;

  const slider = (id: string, label: string, value: number, set: (n: number) => void, min: number, max: number, step: number, show: string, hint: string) => (
    <div>
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-sm font-semibold">{label}<span className="font-display text-xl font-extrabold tabular">{show}</span></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="mt-2 h-11 w-full accent-[var(--brand)]" />
      <p className="-mt-1 text-xs text-muted">{hint}</p>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="card flex flex-col gap-5 p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-widest text-brand">Your numbers</p>
        {slider('c', 'Customers and leads you already have', contacts, setContacts, 200, 50000, 100, fmt(contacts), 'Past buyers, enquiries, walk-ins, ad leads.')}
        {slider('a', 'Who agreed to hear from you', agreed, setAgreed, 10, 100, 5, `${agreed}%`, 'We only message people with a permission on record.')}
        {slider('o', 'Average order or renewal value', order, setOrder, 100, 25000, 100, inr(order * 100).replace('.00', ''), 'What one sale is worth to you.')}
        {slider('b', 'Of those messaged, how many buy or renew?', buy, setBuy, 0.5, 15, 0.5, `${buy}%`, 'Your honest guess. Be cautious: start low.')}
      </div>

      <div className="aurora rounded-[1.25rem] p-6 sm:p-8" aria-live="polite">
        <div className="blob" />
        <p className="text-xs font-bold uppercase tracking-widest text-white/70">One message to everyone who agreed</p>
        <p className="mt-2 font-display text-5xl font-extrabold tabular sm:text-6xl"><span className="text-white">{inr(Math.round(revenue) * 100).replace('.00', '')}</span></p>
        <p className="text-sm text-white/70">possible sales from {fmt(orders)} {orders === 1 ? 'order' : 'orders'}, using your own guesses</p>
        <dl className="mt-6 divide-y divide-white/15 text-sm">
          <div className="flex justify-between py-2.5"><dt className="text-white/70">People reached</dt><dd className="font-semibold tabular">{fmt(reach)}</dd></div>
          <div className="flex justify-between py-2.5"><dt className="text-white/70">{fmt(reach)} × ₹0.8631 (promotional)</dt><dd className="font-semibold tabular">{cost.baseLabel}</dd></div>
          <div className="flex justify-between py-2.5"><dt className="text-white/70">GST 18%</dt><dd className="font-semibold tabular">{cost.gstLabel}</dd></div>
          <div className="flex justify-between py-3 text-base"><dt className="font-bold">WhatsApp charge, paid to Meta</dt><dd className="font-display text-2xl font-extrabold tabular">{cost.totalLabel}</dd></div>
        </dl>
        <p className="mt-2 rounded-xl bg-white/10 p-3 text-sm">{multiple >= 1 ? <>On these numbers, every <strong>₹1</strong> of message cost brings back about <strong>₹{multiple.toFixed(0)}</strong>.</> : <>On these numbers the send would not pay back. Try a better offer or a warmer list.</>}</p>
        <p className="mt-3 text-xs text-white/60">An illustration from your own inputs, not a promise. Rate: ₹0.8631 per promotional message ex-GST (July 2026 India card, to be confirmed against Meta’s own sheet). Meta may block some messages, and blocked ones are not charged. Our plan fee is extra.</p>
      </div>
    </div>
  );
}

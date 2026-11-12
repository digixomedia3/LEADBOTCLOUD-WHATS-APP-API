'use client';

import { useState } from 'react';

// Meta India rate card, Jul 2026, ex-GST (spec Part B, marked [BSP] = verify against Meta's CSV). Paise per message.
const RATES = { marketing: { label: 'Promotional', paise: 86.31 }, utility: { label: 'Updates', paise: 11.5 } } as const;
const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Honest cost preview: the same maths the campaign screen uses. Meta charges this to the customer's card, not to us. */
export function CostCalculator() {
  const [n, setN] = useState(1000);
  const [kind, setKind] = useState<keyof typeof RATES>('marketing');
  const base = Math.round(n * RATES[kind].paise);
  const gst = Math.round(base * 0.18);
  return (
    <div className="card mx-auto max-w-xl p-6 sm:p-8">
      <div className="mb-5 grid grid-cols-2 gap-2" role="tablist" aria-label="Message type">
        {(Object.keys(RATES) as (keyof typeof RATES)[]).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`min-h-12 rounded-xl border text-sm font-semibold ${kind === k ? 'border-brand bg-brand/10 text-brand' : 'border-line'}`}>{RATES[k].label}</button>
        ))}
      </div>
      <label htmlFor="n" className="flex items-baseline justify-between text-sm font-semibold">Messages to send<span className="font-display text-2xl font-extrabold tabular">{n.toLocaleString('en-IN')}</span></label>
      <input id="n" type="range" min={100} max={100000} step={100} value={n} onChange={(e) => setN(Number(e.target.value))} className="mt-3 h-11 w-full accent-[var(--brand)]" />
      <dl className="mt-5 divide-y divide-line text-sm">
        <div className="flex justify-between py-2.5"><dt className="text-muted">{n.toLocaleString('en-IN')} × {inr(RATES[kind].paise)}</dt><dd className="tabular font-semibold">{inr(base)}</dd></div>
        <div className="flex justify-between py-2.5"><dt className="text-muted">GST 18%</dt><dd className="tabular font-semibold">{inr(gst)}</dd></div>
        <div className="flex justify-between py-3"><dt className="font-bold">Estimated WhatsApp charge</dt><dd className="grad-text font-display text-2xl font-extrabold tabular">{inr(base + gst)}</dd></div>
      </dl>
      <p className="text-xs text-muted">Estimate using the July 2026 India rate card. Meta bills this to your own card, and may not charge messages it blocks. We add no markup on messages.</p>
    </div>
  );
}

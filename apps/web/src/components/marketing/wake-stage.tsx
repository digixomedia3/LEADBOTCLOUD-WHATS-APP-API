'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, RotateCcw, Send } from 'lucide-react';
import { estimateCost, inr } from '@/lib/cost';
import { cn } from '@/lib/utils';

const COLS = 20;
const N = 200; // one dot = half a percent of the list. The picture is illustrative; every number beside it is exact.
const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

// A fixed shuffle (same on server and browser), so skipped and buying dots scatter instead of forming blocks.
const PERM = (() => {
  const a = Array.from({ length: N }, (_, i) => i);
  let s = 11;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
})();

function useCountUp(target: number, run: boolean) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (!run || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); from.current = target; return; }
    const start = performance.now(); const a = from.current; let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1100); const e = 1 - Math.pow(1 - p, 3);
      setV(a + (target - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return v;
}

function Slider({ id, label, value, set, min, max, step, show, hint }: { id: string; label: string; value: number; set: (n: number) => void; min: number; max: number; step: number; show: string; hint: string }) {
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-sm font-semibold">{label}<span className="font-display text-2xl font-extrabold tabular-nums">{show}</span></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="mt-1.5 h-11 w-full accent-[var(--brand)]" />
      <p className="-mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

/**
 * "Press send, see what wakes up." The visitor's own numbers drive a picture of their list: asleep, skipped (no permission), messaged, buying.
 * Cost is Meta's published India rate (lib/cost). Sales come only from the visitor's own guesses and are labelled as such. No invented benchmarks.
 */
export function WakeStage({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  const [contacts, setContacts] = useState(3000);
  const [agreed, setAgreed] = useState(70);
  const [order, setOrder] = useState(1500);
  const [buy, setBuy] = useState(1);
  const [sent, setSent] = useState(false);
  const [round, setRound] = useState(0);

  const reach = Math.round((contacts * agreed) / 100);
  const skipped = contacts - reach;
  const cost = estimateCost(reach, 'marketing');
  const orders = (reach * buy) / 100;
  const revenue = orders * order;
  const multiple = cost.totalPaise > 0 ? revenue / (cost.totalPaise / 100) : 0;
  const shownRevenue = useCountUp(revenue, sent);

  const kinds = useMemo(() => {
    const skipN = N - Math.round((N * agreed) / 100);
    const reachN = N - skipN;
    const buyN = orders > 0 && reachN > 0 ? Math.min(reachN, Math.max(1, Math.round((reachN * buy) / 100))) : 0;
    const k: ('skip' | 'reach' | 'buy')[] = new Array(N);
    PERM.forEach((cell, i) => { k[cell] = i < skipN ? 'skip' : i < skipN + buyN ? 'buy' : 'reach'; });
    return k;
  }, [agreed, buy, orders]);

  const send = () => { setSent(true); setRound((r) => r + 1); };
  const reset = () => { setSent(false); };

  return (
    <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
      {/* Controls */}
      <div className="card flex flex-col gap-5 p-6 sm:p-7">
        <h3 className="font-display text-xl font-bold">Your business, your numbers</h3>
        <Slider id="c" label="Contacts you already have" value={contacts} set={setContacts} min={200} max={50000} step={100} show={fmt(contacts)} hint="Past buyers, enquiries, walk-ins, ad leads." />
        <Slider id="a" label="Who agreed to hear from you" value={agreed} set={setAgreed} min={10} max={100} step={5} show={`${agreed}%`} hint="Only people with a permission on record get a message." />
        <Slider id="o" label="Worth of one sale or renewal" value={order} set={setOrder} min={100} max={25000} step={100} show={inr(order * 100).replace('.00', '')} hint="What one customer is worth to you." />
        <Slider id="b" label="Of those messaged, who buys or renews" value={buy} set={setBuy} min={0.5} max={15} step={0.5} show={`${buy}%`} hint="Your honest guess. Start low." />
      </div>

      {/* The list */}
      <div className="lp-drench lp-drench-deep rounded-[1.6rem] p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-display text-xl font-bold"><span className="tabular-nums">{fmt(contacts)}</span> people <span className="text-white/60">in your list</span></p>
          {sent ? (
            <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-semibold text-white/90 transition hover:bg-white/10"><RotateCcw className="size-4" />Put them back to sleep</button>
          ) : (
            <button type="button" onClick={send} className="lp-wa-btn inline-flex min-h-12 items-center gap-2 rounded-xl px-6 text-base font-bold"><Send className="size-5" />Send to my list</button>
          )}
        </div>

        <div key={round} data-sent={sent} className="wk mt-5 grid gap-[5px] sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }} role="img"
          aria-label={sent ? `${fmt(reach)} people messaged, about ${fmt(orders)} orders` : `${fmt(contacts)} contacts asleep. ${fmt(skipped)} would be skipped for no permission.`}>
          {kinds.map((k, i) => {
            const col = i % COLS; const row = Math.floor(i / COLS);
            const base = (col + row) * 18;
            return <i key={i} className="wk-dot" data-k={k} style={{ ['--d' as string]: `${k === 'buy' ? base + 900 : base}ms`, ['--s' as string]: `${(i % 9) * 0.35}s` }} />;
          })}
        </div>

        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-white/75">
          <li className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-white/25" />Asleep</li>
          <li className="flex items-center gap-1.5"><i className="size-2.5 rounded-full shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.45)]" />Skipped: no permission</li>
          <li className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-[var(--lp-wa)]" />Messaged</li>
          <li className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-[var(--lp-gold)]" />Buys or renews</li>
        </ul>

        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-white/15 pt-5">
          <div>
            <dt className="text-xs text-white/65">You pay Meta, with GST</dt>
            <dd className="font-display text-3xl font-extrabold tabular-nums sm:text-4xl">{cost.totalLabel.replace('.00', '')}</dd>
            <dd className="text-xs text-white/60">for {fmt(reach)} messages. {fmt(skipped)} skipped.</dd>
          </div>
          <div aria-live="polite">
            <dt className="text-xs text-white/65">Possible sales, on your guesses</dt>
            <dd className={cn('font-display text-3xl font-extrabold tabular-nums sm:text-4xl', sent ? 'text-[var(--lp-gold)]' : 'text-white/35')}>{sent ? inr(Math.round(shownRevenue) * 100).replace('.00', '') : '₹ ?'}</dd>
            <dd className="text-xs text-white/60">{sent ? `from about ${fmt(orders)} ${orders === 1 ? 'order' : 'orders'}` : 'Press send to find out.'}</dd>
          </div>
        </dl>

        <div className={cn('mt-5 rounded-2xl bg-white/10 p-4 text-sm transition-all duration-500', sent ? 'opacity-100' : 'pointer-events-none h-0 overflow-hidden p-0 opacity-0')}>
          <p>{multiple >= 1 ? <>On these numbers, every <strong>₹1</strong> spent on messages brings back about <strong className="text-[var(--lp-gold)]">₹{multiple.toFixed(0)}</strong>.</> : <>On these numbers the send would not pay back. Try a warmer list or a better offer. We would rather you know now.</>}</p>
          <Link href={ctaHref} className="lp-wa-btn mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-base font-bold">{ctaLabel}: do this with your real list<ArrowRight className="size-5" /></Link>
        </div>

        <details className="mt-4 text-xs text-white/65">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-white/80">Show the maths and the fine print</summary>
          <p>{fmt(reach)} × ₹0.8631 (promotional) = {cost.baseLabel}. GST 18% = {cost.gstLabel}. Total {cost.totalLabel}, paid to Meta from your own card. Our plan fee is extra.</p>
          <p className="mt-2">Dots are a picture (each is half a percent of your list); the numbers beside them are exact. Sales come only from your own guesses and are not a promise. Rate: July 2026 India card, ex-GST, to be confirmed against Meta’s own sheet. Meta may block some messages, and blocked ones are not charged.</p>
        </details>
      </div>
    </div>
  );
}

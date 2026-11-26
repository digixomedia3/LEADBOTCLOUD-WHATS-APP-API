'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { estimateCost, GST_PCT, RATE_PAISE_X100 } from '@/lib/cost';
import { Band, CARD, CONTAINER, Check, Icon, SAMPLE_TAG, STAGE, SectionHead } from './kit';

/** Cost before you send: every figure is estimateCost() from lib/cost (Meta India rate card), shown as a sample estimate. */
const TYPES = [
  { id: 'marketing', label: 'Promotional', hint: 'Offers, festival sales, follow-ups' },
  { id: 'utility', label: 'Update', hint: 'Orders, bookings, payments' },
  { id: 'authentication', label: 'Login code', hint: 'One-time passwords' },
] as const;
const CAPS = [1000, 2500, 5000, 0] as const;
const STEPS = [100, 250, 500, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 25000, 50000, 100000];
const fmt = (n: number) => n.toLocaleString('en-IN');
const rupees = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
const perMsg = (rateX100: number) => '₹' + (rateX100 / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

export function CostCheck({ ctaHref }: { ctaHref: string }) {
  const [si, setSi] = useState(5);
  const [type, setType] = useState<(typeof TYPES)[number]['id']>('marketing');
  const [cap, setCap] = useState<number>(2500);
  const n = STEPS[si]!;
  const est = useMemo(() => estimateCost(n, type), [n, type]);
  const asUpdate = useMemo(() => estimateCost(n, 'utility'), [n]);
  const capPaise = cap * 100;
  const over = cap > 0 && est.totalPaise > capPaise;
  const basePct = (est.basePaise / est.totalPaise) * 100;
  const rate = RATE_PAISE_X100[type];

  return (
    <Band tone="night" id="cost" labelledBy="cost-title" className="py-12 sm:py-20 lg:py-24">
      <div className={CONTAINER}>
        <SectionHead id="cost-title" tone="emerald" n="03" eyebrow="Cost, before you send" title="Know the exact cost" highlight="before you press send."
          lead="Meta charges per message. LeadBotCloud adds up the total with GST before anything goes out, and holds the campaign if it is over your cap." />

        <div className={`sr-in ${STAGE} mt-10 sm:mt-12 p-4 sm:p-6 lg:p-8`}>
          <div className="absolute -top-16 left-1/3 w-80 h-44 bg-emerald-500/[0.07] blur-3xl pointer-events-none" />
          <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10">
            {/* Controls */}
            <div className="lg:col-span-6 flex flex-col justify-between gap-7">
              <div>
                <div className="flex items-end justify-between gap-3">
                  <label htmlFor="cost-n" className="text-sm font-semibold text-slate-700 dark:text-slate-200">People who agreed to hear from you</label>
                  <output htmlFor="cost-n" className="font-jk font-extrabold text-2xl sm:text-[1.75rem] tracking-tight tabular-nums text-slate-900 dark:text-white">{fmt(n)}</output>
                </div>
                <input id="cost-n" type="range" min={0} max={STEPS.length - 1} step={1} value={si} onChange={(e) => setSi(Number(e.target.value))}
                  aria-valuetext={`${fmt(n)} people`} className="mt-3" />
                <div className="mt-1 flex justify-between text-[11px] text-slate-400 tabular-nums"><span>100</span><span>1,00,000</span></div>
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2.5">What are you sending?</legend>
                <div className="grid grid-cols-3 gap-2">
                  {TYPES.map((t) => {
                    const on = t.id === type;
                    return (
                      <button key={t.id} type="button" aria-pressed={on} onClick={() => setType(t.id)}
                        className={`text-left p-2.5 sm:p-3 rounded-xl border transition-all cursor-pointer min-h-11 ${on ? 'bg-slate-900 dark:bg-emerald-500 border-transparent text-white dark:text-slate-950 shadow-xs' : 'bg-white dark:bg-slate-800/80 border-slate-900/[0.09] dark:border-white/[0.09] text-slate-700 dark:text-slate-200 hover:border-emerald-500/40'}`}>
                        <div className="text-[13px] font-bold">{t.label}</div>
                        <div className={`hidden sm:block text-[11px] mt-0.5 leading-snug ${on ? 'text-white/70 dark:text-slate-900/70' : 'text-slate-500 dark:text-slate-400'}`}>{t.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2.5">Your spend cap for this campaign</legend>
                <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-2">
                  {CAPS.map((c) => {
                    const on = c === cap;
                    return (
                      <button key={c} type="button" aria-pressed={on} onClick={() => setCap(c)}
                        className={`min-h-11 px-2 sm:px-4 rounded-xl border text-[13px] sm:text-sm font-semibold tabular-nums transition-all cursor-pointer ${on ? 'bg-emerald-500/12 border-emerald-500/50 text-emerald-700 dark:text-emerald-300' : 'bg-white dark:bg-slate-800/80 border-slate-900/[0.09] dark:border-white/[0.09] text-slate-600 dark:text-slate-300 hover:border-emerald-500/40'}`}>
                        {c ? `₹${fmt(c)}` : 'No cap'}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            {/* Receipt */}
            <div className="lg:col-span-6">
              <div className={`${CARD} p-4 sm:p-5`} aria-live="polite">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"><Icon name="doc" className="w-4 h-4" /></span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">Cost preview</span>
                  </div>
                  <span className={SAMPLE_TAG}>Sample estimate</span>
                </div>

                <dl className="mt-4 space-y-2.5 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">{fmt(n)} messages × {perMsg(rate)}</dt><dd className="font-semibold tabular-nums text-slate-900 dark:text-white">{est.baseLabel}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">GST {GST_PCT}%</dt><dd className="font-semibold tabular-nums text-slate-900 dark:text-white">{est.gstLabel}</dd></div>
                  <div className="h-2 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-700/60" aria-hidden="true">
                    <div className="bg-emerald-500 transition-[width] duration-500" style={{ width: `${basePct}%` }} />
                    <div className="bg-indigo-400 transition-[width] duration-500" style={{ width: `${100 - basePct}%` }} />
                  </div>
                  <div className="pt-2 border-t border-dashed border-slate-900/[0.12] dark:border-white/[0.12] flex items-end justify-between gap-3">
                    <dt className="font-semibold text-slate-700 dark:text-slate-200">Meta charge, total</dt>
                    <dd className="font-jk font-extrabold text-[1.9rem] sm:text-[2.2rem] leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">{est.totalLabel}</dd>
                  </div>
                </dl>

                <div className={`mt-4 flex items-start gap-2.5 p-3 rounded-xl border transition-colors ${over ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-500/30' : 'bg-emerald-50/80 dark:bg-emerald-500/10 border-emerald-500/30'}`}>
                  <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-white ${over ? 'bg-rose-500' : 'bg-emerald-500'}`}>
                    {over ? <Icon name="stop" className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                  </span>
                  <div className="text-[13px] leading-snug">
                    {over ? (
                      <><b className="text-rose-700 dark:text-rose-300">Held. Nothing is sent.</b> <span className="text-slate-600 dark:text-slate-300">The estimate is over your ₹{fmt(cap)} cap. Raise the cap or send to fewer people.</span></>
                    ) : (
                      <><b className="text-emerald-700 dark:text-emerald-300">Ready to send.</b> <span className="text-slate-600 dark:text-slate-300">{cap ? `Inside your ₹${fmt(cap)} cap.` : 'No cap set: you confirm this total before it goes.'}</span></>
                    )}
                  </div>
                </div>

                {type === 'marketing' ? (
                  <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-slate-500 dark:text-slate-400">
                    <span>The same people, sent an order or booking update instead</span>
                    <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200 shrink-0">{rupees(asUpdate.totalPaise)}</span>
                  </div>
                ) : null}
              </div>
              <Link href={ctaHref} className="btn-sheen group mt-4 flex items-center justify-center gap-2 w-full min-h-12 rounded-xl bg-linear-to-b/srgb from-[#10B981] to-[#059669] text-white text-[15px] font-semibold shadow-cta-emerald active:scale-[0.98]">
                Start free and set your cap
                <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
              </Link>
              <p className="mt-3 text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                Sample estimate from Meta’s India rate card (July 2026): {perMsg(RATE_PAISE_X100.marketing)} per promotional message and {perMsg(RATE_PAISE_X100.utility)} per update or login code, before GST. Meta bills these to you directly and can change them; we add no markup. The live preview before each send is what counts.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Band>
  );
}

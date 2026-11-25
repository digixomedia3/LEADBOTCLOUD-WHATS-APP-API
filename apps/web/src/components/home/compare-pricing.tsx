'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CARD, CONTAINER, Check, Cross, SectionHead, STAGE, TONE } from './kit';

/* ---------------- App vs LeadBotCloud ---------------- */
const ROWS: [string, string, string][] = [
  ['Who receives it', 'Only people who saved your number', 'Everyone with permission on record'],
  ['List size', 'Broadcast lists stop at 256', 'Your whole list, up to your plan’s limit'],
  ['Your team', 'One phone and a few linked devices', 'Shared inbox with assignment and notes'],
  ['Opted-out people', 'You have to remember to skip them', 'Skipped automatically and logged'],
  ['Follow-ups', 'Typed by hand, one by one', 'Flows that wait, check and follow up'],
  ['Risk to your number', 'Campaigning from it can get it flagged', 'Checks and limits built to protect it'],
];

export function Compare({ proContacts }: { proContacts: number }) {
  const [side, setSide] = useState<'app' | 'lbc'>('lbc');
  const appPct = Math.max((256 / proContacts) * 100, 0.6);
  return (
    <section id="compare" className="scroll-mt-20 py-16 sm:py-24" aria-labelledby="compare-title">
      <div className={CONTAINER}>
        <SectionHead id="compare-title" tone="indigo" eyebrow="Why not the free app?" title="Outgrown the" highlight="WhatsApp Business app?"
          lead="The app is made for chatting from one phone. LeadBotCloud is made for selling to a list, with a team, on the official platform." />

        <div className={`sr-in ${STAGE} mt-10 sm:mt-12 p-4 sm:p-6 lg:p-8`}>
          {/* Reach meter */}
          <div className="space-y-4">
            <div className="text-sm font-bold text-slate-900 dark:text-white">How many people one send can reach</div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 text-[13px] mb-1.5"><span className="font-semibold text-slate-600 dark:text-slate-300">WhatsApp Business app</span><span className="font-bold tabular-nums text-slate-900 dark:text-white">256 per broadcast list</span></div>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-700/60 overflow-hidden"><div className="h-full rounded-full bg-slate-400 dark:bg-slate-500" style={{ width: `${appPct}%` }} /></div>
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 text-[13px] mb-1.5"><span className="font-semibold text-slate-600 dark:text-slate-300">LeadBotCloud</span><span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">Up to {proContacts.toLocaleString('en-IN')} contacts</span></div>
              <div className="h-3 rounded-full overflow-hidden bg-linear-to-r/srgb from-amber-500 via-indigo-500 to-emerald-500" />
            </div>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Contact limit of the Pro plan. Meta also sets a daily limit per number that grows as your number earns trust.</p>
          </div>

          {/* Phone toggle */}
          <div className="md:hidden mt-7 inline-flex w-full p-1 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-slate-900/[0.08] dark:border-white/[0.09] shadow-xs" role="group" aria-label="Compare">
            {([['app', 'Business app'], ['lbc', 'LeadBotCloud']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={side === k} onClick={() => setSide(k)}
                className={`flex-1 min-h-11 rounded-xl text-[13px] font-semibold transition-all cursor-pointer ${side === k ? 'bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950 shadow-xs' : 'text-slate-600 dark:text-slate-300'}`}>{l}</button>
            ))}
          </div>

          <div className="mt-4 md:mt-8 rounded-2xl border border-slate-900/[0.07] dark:border-white/[0.08] overflow-hidden">
            <div className="hidden md:grid grid-cols-[1fr_1.3fr_1.3fr] bg-slate-50/80 dark:bg-slate-900/60 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <div className="px-4 py-3" />
              <div className="px-4 py-3">WhatsApp Business app</div>
              <div className="px-4 py-3 text-emerald-700 dark:text-emerald-300">LeadBotCloud</div>
            </div>
            {ROWS.map(([k, a, b]) => (
              <div key={k} className="grid grid-cols-1 md:grid-cols-[1fr_1.3fr_1.3fr] border-t first:border-t-0 md:first:border-t border-slate-900/[0.06] dark:border-white/[0.07] bg-white/70 dark:bg-slate-800/40">
                <div className="px-4 pt-3 md:py-3.5 text-[12px] md:text-sm font-bold uppercase md:normal-case tracking-wider md:tracking-normal text-slate-500 md:text-slate-900 dark:text-slate-400 md:dark:text-white">{k}</div>
                <div className={`${side === 'app' ? 'flex' : 'hidden'} md:flex items-start gap-2 px-4 pb-3 pt-1 md:py-3.5 text-[14px] text-slate-600 dark:text-slate-300`}>
                  <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center"><Cross className="w-3 h-3" /></span>{a}
                </div>
                <div className={`${side === 'lbc' ? 'flex' : 'hidden'} md:flex items-start gap-2 px-4 pb-3 pt-1 md:py-3.5 text-[14px] font-medium text-slate-800 dark:text-slate-100 md:bg-emerald-50/40 md:dark:bg-emerald-500/[0.05]`}>
                  <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><Check className="w-3 h-3" /></span>{b}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] text-slate-500 dark:text-slate-400">The official platform has rules too: approved templates, permission from each person, and per-message charges from Meta. LeadBotCloud handles them for you.</p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Pricing ---------------- */
export type PlanCard = { id: string; label: string; price: string; gstNote: string; contacts: number; users: number; note: string; points: string[] };
const STEPS = [200, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

export function Pricing({ plans, ctaHref, ctaLabel }: { plans: PlanCard[]; ctaHref: string; ctaLabel: string }) {
  const [si, setSi] = useState(3);
  const n = STEPS[si]!;
  const fit = plans.find((p) => p.contacts >= n)?.id ?? plans[plans.length - 1]!.id;
  const rail = useRef<HTMLDivElement>(null);
  const prev = useRef(fit);
  useEffect(() => {
    // Phones show the plans as a swipe rail: bring the plan that fits into view when the slider moves (not on first paint).
    if (prev.current === fit) return;
    prev.current = fit;
    const r = rail.current, el = r?.querySelector<HTMLElement>(`[data-plan="${fit}"]`);
    if (!r || !el || r.scrollWidth <= r.clientWidth) return;
    r.scrollTo({ left: el.offsetLeft - (r.clientWidth - el.clientWidth) / 2, behavior: 'smooth' });
  }, [fit]);
  return (
    <section id="pricing" className="scroll-mt-20 py-16 sm:py-24 border-y border-slate-900/[0.05] dark:border-white/[0.05] bg-white/40 dark:bg-white/[0.015]" aria-labelledby="pricing-title">
      <div className={CONTAINER}>
        <SectionHead id="pricing-title" tone="emerald" eyebrow="Pricing" title="One flat monthly fee." highlight="Meta’s charges at cost."
          lead="Pay us for the plan. Meta bills message charges to you directly, and we add no markup. Start free, no card needed." />

        <div className={`sr-in ${CARD} mt-10 sm:mt-12 p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-4 md:gap-8`}>
          <div className="md:w-[300px] shrink-0">
            <label htmlFor="plan-n" className="text-sm font-semibold text-slate-700 dark:text-slate-200">How many contacts do you have?</label>
            <div className="font-jk font-extrabold text-2xl tracking-tight tabular-nums text-slate-900 dark:text-white mt-0.5"><output htmlFor="plan-n">{n.toLocaleString('en-IN')}</output></div>
          </div>
          <div className="flex-1">
            <input id="plan-n" type="range" min={0} max={STEPS.length - 1} step={1} value={si} onChange={(e) => setSi(Number(e.target.value))} aria-valuetext={`${n.toLocaleString('en-IN')} contacts`} />
            <div className="mt-1 flex justify-between text-[11px] text-slate-400 tabular-nums"><span>200</span><span>1,00,000</span></div>
          </div>
        </div>

        <div ref={rail} className="sr-in mt-4 -mx-4 px-4 pt-3 pb-2 sm:mx-0 sm:px-0 flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 overflow-x-auto sm:overflow-visible snap-x snap-mandatory no-scrollbar">
          {plans.map((p) => {
            const best = p.id === fit;
            return (
              <div key={p.id} data-plan={p.id} className={`relative snap-center shrink-0 w-[84%] sm:w-auto flex flex-col p-5 rounded-[22px] border transition-all duration-300 ${best ? 'bg-white dark:bg-slate-800/95 border-transparent ring-2 ring-emerald-500/60 shadow-card-light dark:shadow-card-dark lg:-translate-y-1' : 'bg-white/70 dark:bg-slate-900/50 border-slate-900/[0.08] dark:border-white/[0.08]'}`}>
                {best ? <span className="absolute -top-2.5 left-5 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-500 text-white shadow-xs">Fits {n.toLocaleString('en-IN')} contacts</span> : null}
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-jk font-bold text-lg tracking-[-0.01em] text-slate-900 dark:text-white">{p.label}</h3>
                  <span className="text-[12px] text-slate-500 dark:text-slate-400">{p.note}</span>
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-jk font-extrabold text-[2.1rem] leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">{p.price}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">/month</span>
                </div>
                <div className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">{p.gstNote}</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900/60"><div className="text-[10.5px] text-slate-500 dark:text-slate-400">Contacts</div><div className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{p.contacts.toLocaleString('en-IN')}</div></div>
                  <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900/60"><div className="text-[10.5px] text-slate-500 dark:text-slate-400">Team seats</div><div className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{p.users}</div></div>
                </div>
                <ul className="mt-4 space-y-2 flex-1">
                  {p.points.map((x) => (
                    <li key={x} className="flex gap-2 text-[13.5px] text-slate-600 dark:text-slate-300"><span className={`mt-[3px] w-4 h-4 shrink-0 rounded-full flex items-center justify-center ${TONE.emerald.soft}`}><Check className="w-2.5 h-2.5" /></span>{x}</li>
                  ))}
                </ul>
                <Link href={ctaHref} className={`mt-5 inline-flex items-center justify-center min-h-11 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${best ? 'btn-sheen bg-linear-to-b/srgb from-[#10B981] to-[#059669] text-white shadow-cta-emerald' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-900/[0.11] dark:border-white/[0.12] hover:border-emerald-500/50'}`}>
                  {ctaLabel}
                </Link>
              </div>
            );
          })}
        </div>
        <p className="sm:hidden mt-2 text-center text-[11.5px] text-slate-400">Swipe to compare plans</p>
        <p className="sr-in mt-5 text-[12.5px] text-slate-500 dark:text-slate-400 max-w-3xl">Online payment is being switched on. Until then every workspace starts on Free and carries over when paid plans open. You are never charged without a card on file.</p>
      </div>
    </section>
  );
}

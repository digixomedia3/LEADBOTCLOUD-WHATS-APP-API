'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Arrow, Band, BTN_PRIMARY_SM, CONTAINER, Check, Cross, SectionHead, TONE } from './kit';

/* ---------------- App vs LeadBotCloud: two cards side by side, same rows, so the eye compares across ---------------- */
const ROWS: [string, string, string][] = [
  ['Who receives it', 'Only people who saved your number', 'Everyone with permission on record'],
  ['Your team', 'One phone and a few linked devices', 'Shared inbox with assignment and notes'],
  ['Opted-out people', 'You have to remember to skip them', 'Skipped automatically and logged'],
  ['Follow-ups', 'Typed by hand, one by one', 'Flows that wait, check and follow up'],
  ['Reports', 'Ticks per chat, no campaign report', 'Delivered, read, replied and clicked, per campaign'],
  ['Risk to your number', 'Campaigning from it can get it flagged', 'Checks and limits built to protect it'],
];

export function Compare({ proContacts, ctaHref, ctaLabel }: { proContacts: number; ctaHref: string; ctaLabel: string }) {
  const appPct = Math.max((256 / proContacts) * 100, 0.8);
  return (
    <Band tone="paper" id="compare" labelledBy="compare-title" className="py-16 sm:py-24">
      <div className={CONTAINER}>
        <SectionHead id="compare-title" tone="indigo" n="05" eyebrow="Why not the free app?" title="The free app is built for chatting." highlight="This is built for selling."
          lead="The app is made for chatting from one phone. LeadBotCloud is made for selling to a list, with a team, on the official platform." />

        <div className="sr-in mt-10 sm:mt-14 grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6 items-stretch">
          {/* The app */}
          <div className="rounded-[24px] p-5 sm:p-7 bg-slate-50 dark:bg-white/[0.02] border border-slate-900/[0.07] dark:border-white/[0.07]">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-slate-900/[0.06] dark:bg-white/[0.07] text-slate-500 dark:text-slate-400 flex items-center justify-center">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>
              </span>
              <div>
                <div className="font-jk font-bold text-[17px] text-slate-700 dark:text-slate-200">WhatsApp Business app</div>
                <div className="text-[13px] text-slate-500 dark:text-slate-400">Free app on one phone</div>
              </div>
            </div>
            <div className="mt-6">
              <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="text-slate-500 dark:text-slate-400">Reach per send</span><span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">256 per broadcast list</span></div>
              <div className="mt-2 h-2.5 rounded-full bg-slate-200/80 dark:bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-slate-400" style={{ width: `${appPct}%` }} /></div>
            </div>
            <ul className="mt-6 divide-y divide-slate-900/[0.07] dark:divide-white/[0.07]">
              {ROWS.map(([k, a]) => (
                <li key={k} className="py-3.5 flex gap-3">
                  <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center"><Cross className="w-3 h-3" /></span>
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{k}</div><div className="text-[14.5px] text-slate-600 dark:text-slate-400">{a}</div></div>
                </li>
              ))}
            </ul>
          </div>

          {/* LeadBotCloud */}
          <div className="relative rounded-[24px] p-5 sm:p-7 bg-white dark:bg-slate-800/80 border border-transparent ring-2 ring-emerald-500/50 shadow-[0_30px_60px_-24px_rgba(16,185,129,0.35)]">
            <span className="absolute -top-3 right-6 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500 text-white shadow-xs">Built for selling</span>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-linear-to-br/srgb from-emerald-500 via-emerald-600 to-indigo-600 text-white flex items-center justify-center shadow-xs">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.5 17.5H6.2C4.1 17.5 2.5 15.9 2.5 13.9C2.5 12.1 3.8 10.6 5.6 10.4C6.2 7.6 8.7 5.5 11.7 5.5C15.1 5.5 17.9 8.1 18.1 11.4C19.9 11.7 21.5 13.1 21.5 15C21.5 16.9 19.9 18.5 18 18.5H13.5L10.2 21V17.5H7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M12.5 9.2L10.8 12.6H13.3L11.8 15.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div>
                <div className="font-jk font-bold text-[17px] text-slate-900 dark:text-white">LeadBotCloud</div>
                <div className="text-[13px] text-slate-500 dark:text-slate-400">Official platform, your whole team</div>
              </div>
            </div>
            <div className="mt-6">
              <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="text-slate-500 dark:text-slate-400">Reach per send</span><span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">Up to {proContacts.toLocaleString('en-IN')} contacts</span></div>
              <div className="mt-2 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <ul className="mt-6 divide-y divide-slate-900/[0.07] dark:divide-white/[0.07]">
              {ROWS.map(([k, , b]) => (
                <li key={k} className="py-3.5 flex gap-3">
                  <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check className="w-3 h-3" /></span>
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{k}</div><div className="text-[14.5px] font-medium text-slate-900 dark:text-white">{b}</div></div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="sr-in mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl p-5 bg-slate-50 dark:bg-white/[0.02] border border-slate-900/[0.07] dark:border-white/[0.07]">
          <p className="text-[14px] text-slate-600 dark:text-slate-300 max-w-2xl">
            <b className="text-slate-900 dark:text-white">Moving over is a CSV away.</b> Export your contacts, upload them, and say where each person agreed to hear from you. Reach is Pro’s contact limit; Meta also sets a daily limit that grows as your number earns trust.
          </p>
          <Link href={ctaHref} className={`${BTN_PRIMARY_SM} shrink-0`}>
            {ctaLabel}<Arrow />
          </Link>
        </div>
      </div>
    </Band>
  );
}

/* ---------------- Pricing ---------------- */
export type PlanCard = { id: string; label: string; price: string; gstNote: string; contacts: number; users: number; note: string; points: string[] };
const STEPS = [200, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const ALL = ['Cost preview before every send', 'STOP and opt-outs handled for you', 'Template checker', 'Two-step sign-in', 'Export your data any time', 'Monthly, no contract'];

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
    <Band tone="canvas" id="pricing" labelledBy="pricing-title" className="py-16 sm:py-24">
      <div className={CONTAINER}>
        <SectionHead id="pricing-title" tone="emerald" n="06" eyebrow="Pricing" title="One flat monthly fee." highlight="Meta’s charges at cost." align="center"
          lead="Pay us for the plan. Meta bills message charges to you directly, and we add no markup. Start free, no card needed." />

        <div className="sr-in mt-8 sm:mt-10 mx-auto max-w-2xl rounded-2xl p-4 sm:px-6 bg-white dark:bg-slate-800/80 border border-slate-900/[0.08] dark:border-white/[0.08] shadow-card-light dark:shadow-card-dark">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="plan-n" className="text-sm font-semibold text-slate-700 dark:text-slate-200">How many contacts do you have?</label>
            <output htmlFor="plan-n" className="font-jk font-extrabold text-2xl tracking-tight tabular-nums text-slate-900 dark:text-white">{n.toLocaleString('en-IN')}</output>
          </div>
          <input id="plan-n" type="range" min={0} max={STEPS.length - 1} step={1} value={si} onChange={(e) => setSi(Number(e.target.value))} aria-valuetext={`${n.toLocaleString('en-IN')} contacts`} className="mt-1" />
          <div className="flex justify-between text-[11px] text-slate-400 tabular-nums"><span>200</span><span>1,00,000</span></div>
        </div>

        <div ref={rail} className="sr-in mt-8 -mx-4 px-4 pt-3 pb-2 sm:mx-0 sm:px-0 flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 overflow-x-auto sm:overflow-visible snap-x snap-mandatory no-scrollbar">
          {plans.map((p) => {
            const best = p.id === fit;
            return (
              <div key={p.id} data-plan={p.id} className={`relative snap-center shrink-0 w-[84%] sm:w-auto flex flex-col p-6 rounded-[24px] border transition-all duration-300 ${best ? 'bg-white dark:bg-slate-800/95 border-transparent ring-2 ring-emerald-500/60 shadow-[0_30px_60px_-24px_rgba(16,185,129,0.35)]' : 'bg-white/70 dark:bg-slate-900/50 border-slate-900/[0.08] dark:border-white/[0.08]'}`}>
                {best ? <span className="absolute -top-3 left-6 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500 text-white shadow-xs">Fits {n.toLocaleString('en-IN')} contacts</span> : null}
                <h3 className="font-jk font-bold text-lg tracking-[-0.01em] text-slate-900 dark:text-white">{p.label}</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400">{p.note}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="font-jk font-extrabold text-[2.4rem] leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">{p.price}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">/month</span>
                </div>
                <div className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">{p.gstNote}</div>
                <Link href={ctaHref} className={`mt-5 inline-flex items-center justify-center min-h-11 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${best ? 'btn-sheen bg-linear-to-b/srgb from-[#10B981] to-[#059669] text-white shadow-cta-emerald' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-900/[0.11] dark:border-white/[0.12] hover:border-emerald-500/50'}`}>
                  {ctaLabel}
                </Link>
                <div className="mt-5 pt-5 border-t border-slate-900/[0.07] dark:border-white/[0.07] grid grid-cols-2 gap-2">
                  <div><div className="text-[11px] text-slate-500 dark:text-slate-400">Contacts</div><div className="text-[15px] font-bold tabular-nums text-slate-900 dark:text-white">{p.contacts.toLocaleString('en-IN')}</div></div>
                  <div><div className="text-[11px] text-slate-500 dark:text-slate-400">Team seats</div><div className="text-[15px] font-bold tabular-nums text-slate-900 dark:text-white">{p.users}</div></div>
                </div>
                <ul className="mt-4 space-y-2.5 flex-1">
                  {p.points.map((x) => (
                    <li key={x} className="flex gap-2 text-[13.5px] text-slate-600 dark:text-slate-300"><span className={`mt-[3px] w-4 h-4 shrink-0 rounded-full flex items-center justify-center ${TONE.emerald.soft}`}><Check className="w-2.5 h-2.5" /></span>{x}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="sm:hidden mt-1 text-center text-[11.5px] text-slate-400">Swipe to compare plans</p>

        <div className="sr-in mt-8 rounded-2xl px-5 py-4 bg-white/70 dark:bg-white/[0.02] border border-slate-900/[0.07] dark:border-white/[0.07] flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
          <span className="shrink-0 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Every plan includes</span>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {ALL.map((x) => <li key={x} className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-slate-700 dark:text-slate-300"><Check className="w-3.5 h-3.5 text-emerald-500" />{x}</li>)}
          </ul>
        </div>
        <p className="sr-in mt-4 text-center text-[12.5px] text-slate-500 dark:text-slate-400 max-w-3xl mx-auto">Online payment is being switched on. Until then every workspace starts on Free and carries over when paid plans open. You are never charged without a card on file.</p>
      </div>
    </Band>
  );
}

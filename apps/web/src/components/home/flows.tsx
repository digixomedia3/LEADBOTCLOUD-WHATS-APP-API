'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Band, BTN_PRIMARY_SM, CONTAINER, Icon, SAMPLE_TAG, SectionHead, TONE, type Tone } from './kit';
import { useInView, useReducedMotion } from './client-kit';

export type FlowData = {
  id: string; title: string; icon: string; tone: Tone; trigger: string; outcome: string;
  category: 'marketing' | 'utility'; perMessage: string; template: string;
  header?: string; body: string; footer?: string; buttons: { type: string; text: string }[];
  reply: string; replyKind: 'tap' | 'link'; result: string;
};

const CAT = { marketing: 'Promotional', utility: 'Update' } as const;
const DUR = 6500;

/** Flows: six ready-made templates from the real template library. Desktop reads left to right: pick a flow, watch the
 *  phone, follow the steps. Until the visitor picks one it cycles (a timer bar shows when), pausing on hover and off screen.
 *  The per-message charge is lib/cost's Meta India rate incl. GST, labelled as a sample. */
export function Flows({ flows, libraryCount, ctaHref }: { flows: FlowData[]; libraryCount: number; ctaHref: string }) {
  const [i, setI] = useState(0);
  const [touched, setTouched] = useState(false);
  const [hover, setHover] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.3 });
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(0); // 0 template sent, 1 customer acts, 2 outcome

  useEffect(() => {
    if (reduced || !inView) { setPhase(2); return; }
    setPhase(0);
    const a = window.setTimeout(() => setPhase(1), 1500);
    const b = window.setTimeout(() => setPhase(2), 2600);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [i, inView, reduced]);

  const auto = !touched && !reduced;
  const pick = (k: number) => { setTouched(true); setI(k); };
  const next = () => setI((x) => (x + 1) % flows.length);
  const f = flows[i]!;

  const steps: { tone: Tone; icon: string; k: string; t: string; d?: string; on: boolean }[] = [
    { tone: 'amber', icon: 'bolt', k: 'Starts when', t: f.trigger, on: true },
    { tone: 'indigo', icon: 'send', k: 'Sends', t: `“${f.template}” template`, d: `${CAT[f.category]} · ≈ ${f.perMessage} per message incl. GST`, on: true },
    { tone: 'indigo', icon: f.replyKind === 'tap' ? 'chat' : 'globe', k: 'Customer', t: f.replyKind === 'tap' ? `Taps “${f.reply}”` : `Opens “${f.reply}”`, on: phase >= 1 },
    { tone: 'emerald', icon: 'tag', k: 'Result', t: f.outcome, d: f.result, on: phase >= 2 },
  ];

  const lastOn = steps.reduce((m, s, k) => (s.on ? k : m), 0);

  return (
    <Band tone="paper" id="flows" labelledBy="flows-title" className="py-12 sm:py-20 lg:py-24">
      <div className={CONTAINER}>
        <SectionHead id="flows-title" tone="amber" n="02" eyebrow="Ready-made flows" title="Start from a flow that" highlight="already works."
          lead={<>{libraryCount} ready templates written to Meta’s template rules. Pick one, change the words, and it runs. Choose a flow to watch it.</>} />

        <div ref={ref} data-paused={hover || !inView ? '1' : '0'} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          className="sr-in mt-10 sm:mt-14 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
          {/* Selector: chips below lg, a list from lg */}
          <div className="lg:hidden -mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar snap-x" role="tablist" aria-label="Flows">
            {flows.map((x, k) => (
              <button key={x.id} type="button" role="tab" aria-selected={k === i} onClick={() => pick(k)}
                className={`snap-start shrink-0 inline-flex items-center gap-2 min-h-11 pl-2 pr-3.5 rounded-full border text-[13px] font-semibold transition-all cursor-pointer ${k === i ? `bg-white dark:bg-slate-800 border-transparent ring-2 ${TONE[x.tone].ring} text-slate-900 dark:text-white shadow-xs` : 'bg-slate-50 dark:bg-slate-900/50 border-slate-900/[0.08] dark:border-white/[0.08] text-slate-600 dark:text-slate-300'}`}>
                <span className={`w-7 h-7 rounded-full flex items-center justify-center ${TONE[x.tone].soft}`}><Icon name={x.icon} className="w-3.5 h-3.5" /></span>{x.title}
              </button>
            ))}
          </div>
          <div className="hidden lg:flex lg:col-span-4 flex-col gap-1.5" role="tablist" aria-label="Flows" aria-orientation="vertical">
            {flows.map((x, k) => {
              const on = k === i;
              return (
                <button key={x.id} type="button" role="tab" aria-selected={on} onClick={() => pick(k)}
                  className={`relative overflow-hidden text-left flex items-center gap-3 px-3.5 py-3 rounded-2xl border transition-all duration-300 cursor-pointer ${on ? `bg-white dark:bg-slate-800/95 border-transparent ring-1 ${TONE[x.tone].ring} shadow-card-light dark:shadow-card-dark` : 'border-transparent hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}>
                  <span className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${TONE[x.tone].soft}`}><Icon name={x.icon} className="w-[18px] h-[18px]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block font-jk font-bold text-[15px] tracking-[-0.01em] ${on ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>{x.title}</span>
                    <span className="block text-[12.5px] text-slate-500 dark:text-slate-400 truncate">{x.trigger}</span>
                  </span>
                  <svg className={`w-4 h-4 shrink-0 transition-all ${on ? 'text-slate-400 translate-x-0 opacity-100' : 'opacity-0 -translate-x-1'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                  {on && auto ? <span key={`t-${i}`} className={`tab-timer absolute left-0 bottom-0 h-[3px] w-full ${TONE[x.tone].dot}`} style={{ ['--dur' as string]: `${DUR}ms` }} onAnimationEnd={next} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
          {/* phones: the timer lives here because the list is hidden */}
          {auto ? <span key={`m-${i}`} className="lg:hidden tab-timer h-[3px] w-full rounded-full bg-amber-500/70 -mt-3" style={{ ['--dur' as string]: `${DUR}ms` }} onAnimationEnd={next} aria-hidden="true" /> : null}

          {/* Phone */}
          <div className="lg:col-span-4 relative flex justify-center">
            <div className="relative w-full max-w-[300px] rounded-[34px] p-2 bg-[#0F172A] dark:bg-slate-800 shadow-phone-light dark:shadow-phone-dark ring-1 ring-slate-900/15 dark:ring-white/15">
              <div className="h-[380px] rounded-[26px] bg-[#F4F6F9] dark:bg-[#0B1220] overflow-hidden flex flex-col border border-black/5 dark:border-white/5">
                <div className="px-4 pt-2 pb-1.5 bg-white dark:bg-slate-900 flex items-center justify-between text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                  <span>9:41</span><div className="w-16 h-3.5 rounded-full bg-slate-900 dark:bg-black" /><span className="w-2.5 h-2 rounded-xs bg-emerald-500" />
                </div>
                <div className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-900/[0.06] dark:border-white/[0.07] flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-linear-to-br/srgb from-amber-400 to-rose-500 text-white text-[11px] font-bold flex items-center justify-center">YB</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-900 dark:text-white">Your Business</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">WhatsApp Business account</div>
                  </div>
                  <span className={SAMPLE_TAG}>Sample</span>
                </div>
                <div className="flex-1 p-3 flex flex-col gap-2.5 overflow-hidden" key={f.id} aria-live="polite">
                  <div className="self-end max-w-[90%] space-y-1.5 animate-spring-in">
                    <div className="px-3 py-2 rounded-2xl rounded-tr-md bg-linear-to-br/srgb from-emerald-500 to-emerald-600 text-white text-[12px] leading-snug shadow-xs">
                      {f.header ? <div className="font-bold mb-1">{f.header}</div> : null}
                      <div>{f.body}</div>
                      {f.footer ? <div className="mt-1.5 text-[10px] text-white/70">{f.footer}</div> : null}
                    </div>
                    {f.buttons.length ? (
                      <div className="space-y-1">
                        {f.buttons.map((b) => {
                          const tapped = phase >= 1 && b.text === f.reply;
                          return (
                            <div key={b.text} className={`w-full px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border flex items-center justify-center gap-1.5 transition-all duration-300 ${tapped ? 'quick-reply-tapped bg-emerald-500 text-white border-emerald-500' : 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'}`}>
                              {b.type === 'url' ? <Icon name="globe" className="w-3 h-3" /> : null}{b.text}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  {phase >= 1 && f.replyKind === 'tap' ? (
                    <div className="self-start max-w-[80%] animate-spring-in">
                      <div className="px-3 py-2 rounded-2xl rounded-tl-md bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[12px] leading-snug shadow-xs border border-slate-900/[0.06] dark:border-white/[0.07]">{f.reply}</div>
                    </div>
                  ) : null}
                  {phase >= 2 ? (
                    <div className="self-center pt-1 animate-spring-in">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 dark:bg-emerald-400/20 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path className="check-stroke" d="M20 6 9 17l-5-5" /></svg>
                        {f.result}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="lg:col-span-4">
            <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500 mb-3">What happens</div>
            <ol className="relative">
              {steps.map((s, k) => (
                <li key={s.k} className="relative flex gap-3.5 pb-5 last:pb-0">
                  {k < steps.length - 1 ? <span className="absolute left-[19px] top-11 bottom-1 w-px dash-y" aria-hidden="true" /> : null}
                  <span className={`relative z-10 w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-all duration-500 ${s.on ? TONE[s.tone].soft : 'bg-slate-100 dark:bg-white/[0.05] text-slate-400'} ${s.on && k === lastOn ? `ring-2 ${TONE[s.tone].ring}` : ''}`}>
                    <Icon name={s.icon} className="w-[18px] h-[18px]" />
                  </span>
                  <div className={`min-w-0 pt-0.5 transition-opacity duration-500 ${s.on ? 'opacity-100' : 'opacity-40'}`}>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{s.k}</div>
                    <div className="text-[15px] font-semibold leading-snug text-slate-900 dark:text-white">{s.t}</div>
                    {s.d ? <div className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{s.d}</div> : null}
                  </div>
                </li>
              ))}
            </ol>
            <Link href={ctaHref} className={`${BTN_PRIMARY_SM} mt-6`}>
              See all {libraryCount} templates free
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
            </Link>
            <p className="mt-5 pt-4 border-t border-slate-900/[0.07] dark:border-white/[0.07] text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">Per-message figure: Meta’s India charge incl. 18% GST, from the rate card in our cost calculator. A sample: Meta bills it to you and can change it.</p>
          </div>
        </div>
      </div>
    </Band>
  );
}

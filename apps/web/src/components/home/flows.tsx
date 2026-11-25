'use client';

import { useEffect, useState } from 'react';
import { CARD, CONTAINER, Icon, SAMPLE_TAG, STAGE, SectionHead, TONE, type Tone } from './kit';
import { useInView, useReducedMotion } from './client-kit';

export type FlowData = {
  id: string; title: string; icon: string; tone: Tone; trigger: string; outcome: string;
  category: 'marketing' | 'utility'; perMessage: string;
  header?: string; body: string; footer?: string; buttons: { type: string; text: string }[];
  reply: string; replyKind: 'tap' | 'link'; result: string;
};

const CAT = { marketing: 'Promotional', utility: 'Update' } as const;

/** Flows: six ready-made templates from the real template library, played in a phone. Tap a flow to run it; until the
 *  visitor taps, it cycles while on screen. The per-message charge comes from lib/cost and is labelled as a sample. */
export function Flows({ flows, libraryCount }: { flows: FlowData[]; libraryCount: number }) {
  const [i, setI] = useState(0);
  const [touched, setTouched] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.35 });
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(0); // 0 template, 1 customer reply, 2 result

  useEffect(() => {
    if (reduced || !inView) { setPhase(2); return; }
    setPhase(0);
    const a = window.setTimeout(() => setPhase(1), 1500);
    const b = window.setTimeout(() => setPhase(2), 2600);
    const c = !touched ? window.setTimeout(() => setI((x) => (x + 1) % flows.length), 6500) : 0;
    return () => { clearTimeout(a); clearTimeout(b); if (c) clearTimeout(c); };
  }, [i, inView, reduced, touched, flows.length]);

  const pick = (k: number) => { setTouched(true); setI(k); };
  const f = flows[i]!;

  return (
    <section id="flows" className="scroll-mt-20 py-16 sm:py-24 border-y border-slate-900/[0.05] dark:border-white/[0.05] bg-white/40 dark:bg-white/[0.015]" aria-labelledby="flows-title">
      <div className={CONTAINER}>
        <SectionHead id="flows-title" tone="amber" eyebrow="Ready-made flows" title="Start from a flow that" highlight="already works."
          lead={<>{libraryCount} ready templates, written to Meta’s template rules. Pick one, change the words, and it runs. Tap a flow to watch it.</>} />

        <div ref={ref} className="sr-in mt-10 sm:mt-12 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Selector: chips on phones, cards from md */}
          <div className="lg:col-span-7 min-w-0">
            <div className="md:hidden -mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar snap-x" role="tablist" aria-label="Flows">
              {flows.map((x, k) => (
                <button key={x.id} type="button" role="tab" aria-selected={k === i} onClick={() => pick(k)}
                  className={`snap-start shrink-0 inline-flex items-center gap-2 min-h-11 pl-2 pr-3.5 rounded-full border text-[13px] font-semibold transition-all cursor-pointer ${k === i ? `bg-white dark:bg-slate-800 border-transparent ring-2 ${TONE[x.tone].ring} text-slate-900 dark:text-white shadow-xs` : 'bg-white/60 dark:bg-slate-900/50 border-slate-900/[0.08] dark:border-white/[0.08] text-slate-600 dark:text-slate-300'}`}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center ${TONE[x.tone].soft}`}><Icon name={x.icon} className="w-3.5 h-3.5" /></span>{x.title}
                </button>
              ))}
            </div>
            <div className="hidden md:grid grid-cols-2 gap-3" role="tablist" aria-label="Flows">
              {flows.map((x, k) => {
                const on = k === i;
                return (
                  <button key={x.id} type="button" role="tab" aria-selected={on} onClick={() => pick(k)}
                    className={`text-left p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${on ? `bg-white dark:bg-slate-800/95 border-transparent ring-2 ${TONE[x.tone].ring} shadow-card-light dark:shadow-card-dark` : 'bg-white/60 dark:bg-slate-900/45 border-slate-900/[0.07] dark:border-white/[0.07] hover:bg-white dark:hover:bg-slate-800/70'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${TONE[x.tone].soft}`}><Icon name={x.icon} className="w-[18px] h-[18px]" /></span>
                      <div className="min-w-0">
                        <div className="font-jk font-bold text-[15px] tracking-[-0.01em] text-slate-900 dark:text-white">{x.title}</div>
                        <div className="mt-1 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">{x.trigger} <span className="text-slate-300 dark:text-slate-600">→</span> {x.outcome}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${x.category === 'marketing' ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300' : 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300'}`}>{CAT[x.category]}</span>
                      <span className="text-[11.5px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">≈ {x.perMessage} / message</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 hidden md:block">Per-message figures are Meta’s own India charge incl. 18% GST, from the rate card in our cost calculator. Samples: Meta bills them to you and can change them.</p>
          </div>

          {/* Phone */}
          <div className="lg:col-span-5">
            <div className={`${STAGE} p-4 sm:p-6`}>
              <div className="absolute -bottom-16 right-6 w-72 h-44 bg-emerald-500/[0.08] blur-3xl pointer-events-none" />
              <div className="relative flex items-center justify-between gap-2 mb-4">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ${TONE.amber.ring} ${TONE.amber.soft}`}>
                  <Icon name="bolt" className="w-3 h-3" /><span className="truncate max-w-[210px]">{f.trigger}</span>
                </div>
                <span className={SAMPLE_TAG}>Sample</span>
              </div>
              <div className="relative mx-auto w-full max-w-[300px] rounded-[32px] p-2 bg-[#0F172A] dark:bg-slate-800 shadow-phone-light dark:shadow-phone-dark ring-1 ring-slate-900/15 dark:ring-white/15">
                <div className="h-[400px] rounded-[24px] bg-[#F4F6F9] dark:bg-[#0B1220] overflow-hidden flex flex-col border border-black/5 dark:border-white/5">
                  <div className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-900/[0.06] dark:border-white/[0.07] flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-linear-to-br/srgb from-amber-400 to-rose-500 text-white text-[11px] font-bold flex items-center justify-center">YB</div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">Your Business</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">WhatsApp Business account</div>
                    </div>
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
              <div className={`${CARD} md:hidden relative mt-4 p-3 flex items-center justify-between gap-2`}>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-900 dark:text-white">{f.outcome}</div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400">{CAT[f.category]} · ≈ {f.perMessage} / message incl. GST</div>
                </div>
                <span className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${TONE[f.tone].soft}`}><Icon name={f.icon} className="w-4 h-4" /></span>
              </div>
              <p className="md:hidden mt-3 text-[11px] text-slate-500 dark:text-slate-400">Sample Meta charge from our cost calculator’s India rate card. Meta bills it to you.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

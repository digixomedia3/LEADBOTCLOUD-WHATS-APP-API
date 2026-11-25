'use client';

import { useEffect, useState } from 'react';
import { CONTAINER, Check, Icon, SAMPLE_TAG, STAGE, SectionHead } from './kit';
import { useInView, useReducedMotion } from './client-kit';

export type SafetyNode = { icon: string; title: string; value: string; unit: string; skip?: string; note: string };

/** Number safety: the four checks every send passes, as a pipeline. A sample list of 3,000 flows through; people who are
 *  skipped drop out in rose with the reason. Nodes light in order once on screen; reduced motion shows them all at once. */
export function Safety({ nodes }: { nodes: SafetyNode[] }) {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true, threshold: 0.3 });
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduced) { setLit(nodes.length); return; }
    let k = 0;
    const id = window.setInterval(() => { k += 1; setLit(k); if (k >= nodes.length) window.clearInterval(id); }, 420);
    return () => window.clearInterval(id);
  }, [inView, reduced, nodes.length]);

  return (
    <section id="safety" className="scroll-mt-20 py-16 sm:py-24 border-y border-slate-900/[0.05] dark:border-white/[0.05] bg-white/40 dark:bg-white/[0.015]" aria-labelledby="safety-title">
      <div className={CONTAINER}>
        <SectionHead id="safety-title" tone="emerald" eyebrow="Number safety" title="Every send passes" highlight="four checks first."
          lead="A blocked number costs more than any campaign. So the checks run before every send, not after a complaint." />

        <div ref={ref} className={`sr-in ${STAGE} mt-10 sm:mt-12 p-4 sm:p-6 lg:p-8`}>
          <div className="relative flex items-center justify-between gap-2 mb-5">
            <span className="text-sm font-bold text-slate-900 dark:text-white">Before a campaign goes out</span>
            <span className={SAMPLE_TAG}>Sample list of 3,000</span>
          </div>
          <ol className="relative flex flex-col lg:flex-row lg:items-stretch">
            {nodes.map((n, i) => {
              const on = lit > i;
              const first = i === 0, last = i === nodes.length - 1;
              return (
                <li key={n.title} className="flex flex-col lg:flex-row lg:flex-1 min-w-0">
                  {!first ? (
                    <>
                      <div className="lg:hidden relative w-2 h-6 ml-[26px]"><div className="absolute inset-0 dash-y" />{on && !reduced ? <span className="pkt-y" style={{ ['--pc' as string]: '#10B981', ['--pd' as string]: '1.8s' }} /> : null}</div>
                      <div className="hidden lg:block relative w-6 xl:w-8 shrink-0 self-center h-2"><div className="absolute inset-0 dash-x" />{on && !reduced ? <span className="pkt-x" style={{ ['--pc' as string]: '#10B981', ['--pd' as string]: '1.8s' }} /> : null}</div>
                    </>
                  ) : null}
                  <div className={`flex-1 min-w-0 flex flex-col gap-2 lg:gap-0 transition-all duration-500 ${on ? 'opacity-100' : 'opacity-40'}`}>
                    <div className={`flex-1 lg:flex-none p-3 lg:p-3.5 rounded-2xl border transition-all duration-500 ${last ? (on ? 'bg-emerald-500 border-emerald-500 text-white shadow-cta-emerald' : 'bg-white dark:bg-slate-800/90 border-slate-900/[0.08] dark:border-white/[0.08]') : 'bg-white dark:bg-slate-800/90 border-slate-900/[0.08] dark:border-white/[0.08] shadow-card-light dark:shadow-card-dark'} ${on && !last && !first ? 'ring-1 ring-emerald-500/30' : ''}`}>
                      <div className="flex items-center gap-2.5 lg:flex-col lg:items-start lg:gap-2">
                        <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${last && on ? 'bg-white/20 text-white' : first ? 'bg-slate-900/[0.06] dark:bg-white/[0.08] text-slate-600 dark:text-slate-300' : 'bg-emerald-500/12 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400'}`}>
                          <Icon name={n.icon} className="w-[18px] h-[18px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className={`text-[11px] font-bold uppercase tracking-wider ${last && on ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>{!first && !last ? `Check ${i}` : first ? 'Start' : 'Result'}</div>
                          <div className={`text-[14px] font-bold leading-tight ${last && on ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{n.title}</div>
                        </div>
                        <div className="text-right lg:text-left lg:mt-1 shrink-0">
                          <div className={`font-jk font-extrabold text-xl lg:text-[1.55rem] leading-none tracking-tight tabular-nums ${last && on ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{n.value}</div>
                          <div className={`text-[11px] mt-0.5 ${last && on ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>{n.unit}</div>
                        </div>
                      </div>
                      <p className={`hidden lg:block mt-2.5 text-[12px] leading-snug ${last && on ? 'text-white/85' : 'text-slate-500 dark:text-slate-400'}`}>{n.note}</p>
                    </div>
                    {n.skip ? (
                      <div className={`self-start ml-[46px] lg:ml-0 lg:mt-2.5 transition-all duration-500 ${on ? 'translate-y-0' : 'lg:-translate-y-1'}`}>
                        <div className="inline-flex items-start gap-1 px-2 py-1 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[11px] font-semibold leading-snug">
                          <Icon name="stop" className="w-3 h-3 mt-[2px] shrink-0" />{n.skip}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="relative mt-6 pt-5 border-t border-slate-900/[0.06] dark:border-white/[0.07] grid grid-cols-1 md:grid-cols-3 gap-3 text-[13px]">
            {['Skipped people are listed in your report with the reason, never hidden', 'Every STOP is logged with the date and honoured on every future send', 'Messages Meta blocks for frequency limits are not charged, and are shown to you'].map((t) => (
              <div key={t} className="flex gap-2 text-slate-600 dark:text-slate-300"><span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><Check className="w-2.5 h-2.5" /></span>{t}</div>
            ))}
          </div>
        </div>
        <p className="sr-in mt-4 text-[12.5px] text-slate-500 dark:text-slate-400 max-w-3xl">Honest note: nobody can promise Meta will never act on a number. Sending messages people asked for is what keeps it healthy. These checks make that the default.</p>
      </div>
    </section>
  );
}

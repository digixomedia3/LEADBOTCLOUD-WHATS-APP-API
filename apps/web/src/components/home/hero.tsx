'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { PILL_BASE, PILL_FIRST, PILL_IDLE, TAB_OFF, TAB_ON, startHeroEngine } from './hero-engine';

/**
 * Hero, matched to Deep's Gemini/Neon draft (`leadbotcloud_dynamic_hero_section-2.html`). Desktop markup and classes are the
 * draft's, translated to Tailwind v4 (see hero-engine.ts for the mapping). Phone-width changes, all below `sm` (640px):
 * stacked CTAs, one-line phase pills, a three-up source grid, tabs that fit 360px, and vertical connectors.
 * The rupee figures and names in the stage are samples, labelled under the stage.
 */

const SOURCE_CARD =
  'source-card relative sm:flex-1 md:flex-none text-left p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-900/[0.08] dark:border-white/[0.08] shadow-card-light dark:shadow-card-dark transition-all duration-300 hover:border-amber-500/50 cursor-pointer group min-w-0';
const SPARK = 'hidden absolute -top-2 -right-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500 text-white shadow-xs whitespace-nowrap';
const PORT_IN =
  'hidden md:block absolute right-[-5px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 transition-colors duration-300';
const CTRL_BTN =
  'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-900/[0.08] dark:border-white/[0.09] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-500/40 transition-colors shadow-xs cursor-pointer min-h-10 sm:min-h-0';

function Chevron() {
  return (
    <svg className="hidden sm:block w-3.5 h-3.5 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function Hero({ ctaHref, ctaLabel, stats }: { ctaHref: string; ctaLabel: string; stats: { v: string; l: string; accent?: boolean }[] }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => (ref.current ? startHeroEngine(ref.current) : undefined), []);

  return (
    <main ref={ref} id="top" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 sm:pt-12 lg:pt-14 lg:pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
        {/* LEFT 5 COLUMNS: value proposition */}
        <section className="lg:col-span-5 flex flex-col items-start text-left z-10" aria-labelledby="hero-title">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white dark:bg-slate-900/90 border border-slate-900/[0.08] dark:border-white/[0.1] shadow-xs mb-6">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200">
              Official Cloud API <span className="mx-1 text-slate-300 dark:text-slate-600">•</span> Zero-Code Automation
            </span>
          </div>

          <h1 id="hero-title" className="font-jk font-extrabold text-[2.45rem] sm:text-[3.1rem] lg:text-[3.25rem] xl:text-[3.55rem] leading-[1.06] tracking-[-0.035em] text-[#0F172A] dark:text-white mb-5">
            Turn Every Chat Into a{' '}
            <span className="block whitespace-nowrap bg-linear-to-r/srgb from-[#059669] via-[#10B981] to-[#0D9488] dark:from-emerald-400 dark:via-emerald-300 dark:to-teal-300 bg-clip-text text-transparent">
              Qualified Sale.{' '}
            </span>
          </h1>

          <p className="text-[1.02rem] sm:text-[1.08rem] leading-[1.65] text-[#475569] dark:text-slate-400 max-w-[490px] mb-8 text-pretty">
            Capture incoming leads, qualify them automatically in seconds, and sync ready-to-buy customers straight to your CRM—24/7.
          </p>

          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 sm:gap-3.5 w-full sm:w-auto mb-4">
            <Link
              href={ctaHref}
              className="btn-sheen group w-full sm:w-auto sm:flex-none inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-linear-to-b/srgb from-[#10B981] to-[#059669] hover:from-[#12c78b] hover:to-[#04885e] text-white font-semibold text-[15px] whitespace-nowrap shadow-cta-emerald transition-all duration-200 active:scale-[0.98]"
            >
              <span>{ctaLabel}</span>
              <svg className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
            <button
              id="triggerDemoBtn"
              type="button"
              className="group w-full sm:w-auto sm:flex-none inline-flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-white dark:bg-slate-900/80 text-slate-800 dark:text-slate-100 font-semibold text-[15px] whitespace-nowrap border border-slate-900/[0.11] dark:border-white/[0.12] shadow-xs hover:border-emerald-500/50 dark:hover:border-emerald-400/50 hover:bg-emerald-50/40 dark:hover:bg-emerald-500/10 transition-all duration-200 active:scale-[0.98] cursor-pointer"
            >
              <span className="w-5 h-5 rounded-full bg-emerald-500/15 dark:bg-emerald-400/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                <svg className="w-3 h-3 ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </span>
              <span>Trigger Live Demo</span>
            </button>
          </div>

          <p className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium text-slate-500 dark:text-slate-400">
            {['Free plan', 'No card needed', 'Your own WhatsApp number'].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>{t}
              </span>
            ))}
          </p>

          <div className="w-full max-w-[460px] pt-6 border-t border-slate-900/[0.08] dark:border-white/[0.08] grid grid-cols-3 gap-2 sm:gap-4">
            {stats.map((s, i) => (
              <div key={s.l} className={i === 0 ? 'pr-2 sm:pr-4 border-r border-slate-900/[0.08] dark:border-white/[0.08]' : i === 1 ? 'px-1 sm:px-3 border-r border-slate-900/[0.08] dark:border-white/[0.08]' : 'pl-1 sm:pl-3'}>
                <div className={`font-jk font-extrabold text-xl sm:text-2xl tracking-tight ${s.accent ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>{s.v}</div>
                <div className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* RIGHT 7 COLUMNS: the motion stage */}
        <section className="lg:col-span-7 flex flex-col items-center w-full" aria-label="Live demo: a lead is captured, qualified and converted">
          <div
            id="motionStage"
            className="relative w-full rounded-[28px] bg-white/75 dark:bg-slate-900/55 backdrop-blur-xl border border-slate-900/[0.08] dark:border-white/[0.09] shadow-card-light dark:shadow-card-dark p-4 sm:p-6 overflow-hidden transition-colors duration-300"
          >
            <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-80 h-44 bg-indigo-500/[0.07] dark:bg-indigo-500/[0.14] blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 right-8 w-72 h-44 bg-emerald-500/[0.08] dark:bg-emerald-500/[0.14] blur-3xl pointer-events-none" />

            {/* Phase bar */}
            <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 sm:gap-2 pb-4 mb-4 sm:mb-5 border-b border-slate-900/[0.06] dark:border-white/[0.07]">
              <div className="flex items-center justify-between sm:justify-start w-full sm:w-auto gap-1 sm:gap-2 flex-nowrap sm:flex-wrap">
                <div id="phasePill1" className={`${PILL_BASE} ${PILL_FIRST}`}><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />1. Capture</div>
                <Chevron />
                <div id="phasePill2" className={`${PILL_BASE} ${PILL_IDLE}`}><span className="w-1.5 h-1.5 rounded-full bg-slate-400" />2. Qualify</div>
                <Chevron />
                <div id="phasePill3" className={`${PILL_BASE} ${PILL_IDLE}`}><span className="w-1.5 h-1.5 rounded-full bg-slate-400" />3. Convert</div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span id="stageStatusText" className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hidden sm:inline" aria-live="polite">
                  Live Cloud Pipeline
                </span>
                <div className="w-full sm:w-20 h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                  <div id="cycleProgressFill" className="h-full rounded-full bg-linear-to-r/srgb from-amber-500 via-indigo-500 to-emerald-500 transition-[width] duration-75" style={{ width: '0%' }} />
                </div>
              </div>
            </div>

            {/* Pipeline canvas */}
            <div id="pipelineCanvas" className="relative w-full py-2">
              <svg id="pipelineSvg" className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible" aria-hidden="true">
                <defs>
                  <filter id="glowAmber" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="glowEmerald" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <linearGradient id="gradIncoming" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#F59E0B" /><stop offset="60%" stopColor="#4F46E5" /><stop offset="100%" stopColor="#10B981" />
                  </linearGradient>
                  <linearGradient id="gradOutgoing" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#4F46E5" /><stop offset="50%" stopColor="#10B981" /><stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                </defs>
                <g id="baseWiresGroup" />
                <g id="activeWiresGroup" />
                <g id="packetsGroup" />
              </svg>

              <div className="relative z-20 grid grid-cols-1 md:grid-cols-12 gap-0 sm:gap-5 md:gap-4 items-center">
                {/* Stage 1: sources */}
                <div className="md:col-span-3 grid grid-cols-3 gap-2 sm:flex sm:flex-row md:flex-col justify-between sm:gap-3" data-parallax="0.6">
                  {[
                    { t: 'Ad Clicks', s: 'Click-to-Chat', spark: '+1 Lead', anim: 'float-slow-a', tone: 'bg-amber-500/12 dark:bg-amber-400/15 text-amber-600 dark:text-amber-400', icon: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /> },
                    { t: 'Web Forms', s: 'Cart & Webhook', spark: 'Cart Alert', anim: 'float-slow-b', tone: 'bg-indigo-500/12 dark:bg-indigo-400/15 text-indigo-600 dark:text-indigo-400', icon: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 9h10M7 13h6" /></> },
                    { t: 'Broadcasts', s: 'VIP Campaigns', spark: 'Reply In', anim: 'float-slow-a', tone: 'bg-emerald-500/12 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400', icon: <><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" /></> },
                  ].map((c, i) => (
                    <button key={c.t} type="button" id={`sourceCard${i}`} data-scenario-trigger={i} aria-label={`Play the ${c.t} example`} className={`${SOURCE_CARD} ${c.anim}`}>
                      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2.5">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${c.tone}`}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{c.icon}</svg>
                        </div>
                        <div className="min-w-0 max-w-full">
                          <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{c.t}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{c.s}</div>
                        </div>
                      </div>
                      <span id={`sourceSpark${i}`} className={SPARK}>{c.spark}</span>
                      <span data-port={`in-${i}`} className={PORT_IN} />
                    </button>
                  ))}
                </div>

                <div id="mWireIn" className="m-wire sm:hidden" style={{ ['--mw' as string]: '#F59E0B' }} aria-hidden="true" />

                {/* Stage 2: AI pill + phone */}
                <div className="md:col-span-5 flex flex-col items-center justify-center relative">
                  <div id="cloudAiPill" className="relative z-30 -mb-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-slate-900 border border-indigo-500/25 dark:border-indigo-400/35 shadow-md shadow-indigo-500/10 transition-all duration-300">
                    <span id="aiCoreSpinner" className="w-4 h-4 rounded-full bg-indigo-500/15 dark:bg-indigo-400/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center ai-spin-slow">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" /></svg>
                    </span>
                    <span className="text-[11px] font-bold tracking-tight text-slate-800 dark:text-slate-100">Flow Engine</span>
                    <span id="aiStateBadge" className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-indigo-500/12 text-indigo-600 dark:text-indigo-300">Ready</span>
                  </div>

                  <div id="phoneShell" className="relative w-full max-w-[274px] rounded-[32px] p-2 bg-[#0F172A] dark:bg-slate-800 shadow-phone-light dark:shadow-phone-dark ring-1 ring-slate-900/15 dark:ring-white/15 transition-transform duration-300">
                    <span data-port="phone-in" className="hidden md:block absolute left-[-5px] top-[46%] w-2.5 h-2.5 rounded-full bg-indigo-500 ring-4 ring-indigo-500/20 z-30" />
                    <span data-port="phone-out" className="hidden md:block absolute right-[-5px] top-[52%] w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 z-30" />
                    <div className="w-full h-[358px] rounded-[24px] bg-[#F4F6F9] dark:bg-[#0B1220] overflow-hidden flex flex-col border border-black/5 dark:border-white/5">
                      <div className="px-4 pt-2 pb-1.5 bg-white dark:bg-slate-900 flex items-center justify-between text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                        <span>9:41</span>
                        <div className="w-16 h-3.5 rounded-full bg-slate-900 dark:bg-black" />
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2 rounded-xs bg-emerald-500" /></div>
                      </div>
                      <div className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-900/[0.06] dark:border-white/[0.07] flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="relative w-8 h-8 rounded-full bg-linear-to-br/srgb from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
                            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-bold text-slate-900 dark:text-white">LeadBotcloud</span>
                              <svg className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1.06 13.54L7.4 12l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41-5.64 5.66z" /></svg>
                            </div>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Automated • Replies instantly</div>
                          </div>
                        </div>
                        <span id="phoneScenarioTag" className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">API Bot</span>
                      </div>
                      <div id="chatStream" className="phone-scroll flex-1 p-3 space-y-2.5 overflow-y-auto flex flex-col justify-start" />
                      <div className="px-3 py-2 bg-white dark:bg-slate-900 border-t border-slate-900/[0.06] dark:border-white/[0.07] flex items-center gap-2">
                        <div className="flex-1 h-7 px-3 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-400 flex items-center">Auto-piloted via Cloud API...</div>
                        <div className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div id="mWireOut" className="m-wire sm:hidden" style={{ ['--mw' as string]: '#10B981' }} aria-hidden="true" />

                {/* Stage 3: outcomes */}
                <div className="md:col-span-4 flex flex-col gap-3.5" data-parallax="-0.65">
                  <div id="crmCard" className="float-slow-b relative rounded-2xl bg-white dark:bg-slate-800/95 border border-slate-900/[0.08] dark:border-white/[0.09] shadow-card-light dark:shadow-card-dark p-3.5 transition-all duration-300">
                    <span data-port="out-0" className="hidden md:block absolute left-[-5px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white dark:bg-slate-900 border-2 border-emerald-400 transition-colors" />
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-emerald-500/12 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" /></svg>
                        </span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">CRM Synced</span>
                      </div>
                      <span id="crmSyncStatus" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Live
                      </span>
                    </div>
                    <div id="crmLeadFeed" className="space-y-2" />
                  </div>

                  <div id="revenueCard" className="float-slow-a relative rounded-2xl bg-white dark:bg-slate-800/95 border border-slate-900/[0.08] dark:border-white/[0.09] shadow-card-light dark:shadow-card-dark p-3.5 transition-all duration-300">
                    <span data-port="out-1" className="hidden md:block absolute left-[-5px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white dark:bg-slate-900 border-2 border-emerald-400 transition-colors" />
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">Live Revenue Impact</span>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md">+28.4% ↑</span>
                    </div>
                    <div className="flex items-end justify-between gap-2 mb-2 relative">
                      <div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Automated Revenue</div>
                        <div className="flex items-baseline gap-1.5">
                          <span id="revenueValue" className="font-jk font-extrabold text-lg sm:text-xl tracking-tight text-slate-900 dark:text-white">₹2,84,500</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Qualified Today</div>
                        <div id="leadsTodayValue" className="font-jk font-extrabold text-base sm:text-lg text-emerald-600 dark:text-emerald-400">142</div>
                      </div>
                      <div id="revenueDeltaContainer" className="absolute -top-2 right-0 pointer-events-none" />
                    </div>
                    <div className="w-full h-14 relative">
                      <svg className="w-full h-full overflow-visible" viewBox="0 0 210 54" fill="none" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                          <linearGradient id="sparkAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <line x1="0" y1="48" x2="210" y2="48" stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeDasharray="3 3" strokeWidth="1" />
                        <path id="sparkAreaPath" d="M 2 44 C 26 42, 40 36, 62 34 C 84 32, 98 24, 122 22 C 146 20, 162 12, 184 10 L 204 6 L 204 52 L 2 52 Z" fill="url(#sparkAreaGrad)" />
                        <path id="sparkLinePath" className="sparkline-path" d="M 2 44 C 26 42, 40 36, 62 34 C 84 32, 98 24, 122 22 C 146 20, 162 12, 184 10 L 204 6" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        <circle id="sparkPeakHalo" cx="204" cy="6" r="6" fill="#10B981" opacity="0.24" />
                        <circle id="sparkPeakDot" cx="204" cy="6" r="3.2" fill="#10B981" stroke="#FFFFFF" strokeWidth="1.5" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scenario switcher + playback */}
          <div className="mt-4 w-full flex flex-col sm:flex-row items-center justify-between gap-3 px-1">
            <div className="w-full sm:w-auto inline-flex items-center p-1 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-slate-900/[0.08] dark:border-white/[0.09] shadow-xs overflow-x-auto no-scrollbar" role="tablist" aria-label="Automation Use Cases">
              {['Lead Qualification', 'Cart Recovery', 'Instant Booking'].map((t, i) => (
                <button key={t} type="button" role="tab" aria-selected={i === 0} data-scenario={i} className={i === 0 ? TAB_ON : TAB_OFF}>{t}</button>
              ))}
            </div>
            <span className="order-last sm:order-none sm:hidden md:inline text-[11px] font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap">Sample chat &amp; figures</span>
            <div className="flex items-center gap-2 shrink-0">
              <button id="pausePlayBtn" type="button" aria-label="Pause animation" className={CTRL_BTN}>
                <svg id="pauseIcon" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                <svg id="playIcon" className="w-3.5 h-3.5 hidden" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                <span id="pausePlayLabel">Pause</span>
              </button>
              <button id="replayBtn" type="button" aria-label="Replay animation" className={CTRL_BTN}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                <span>Replay</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

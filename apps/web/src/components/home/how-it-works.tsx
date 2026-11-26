'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Band, CARD, CONTAINER, Check, Icon, SAMPLE_TAG, STAGE, SectionHead, TONE, type Tone } from './kit';
import { useInView, useReducedMotion } from './client-kit';

/** How it works: the hero's three phases, each opened up into the real screen behind it. Tabs auto-advance (a timer bar
 *  shows when) until the visitor touches them; hover or leaving the screen pauses; reduced motion never auto-advances. */
const STEPS: { key: string; tone: Tone; n: string; short: string; title: string; sub: string; points: string[] }[] = [
  {
    key: 'capture', tone: 'amber', n: 'list', short: 'Lead inbox', title: 'Every lead lands in one inbox', sub: 'Ads, forms, your site, Shopify, Sheets, IndiaMART',
    points: ['Click-to-WhatsApp ads, website button, hosted forms with QR codes', 'From ads, forms, Shopify, Sheets, IndiaMART, JustDial or a CSV', 'Duplicates merged; permission to message recorded separately'],
  },
  {
    key: 'qualify', tone: 'indigo', n: 'split', short: 'Flow builder', title: 'A flow asks the right questions', sub: 'Templates, waits and conditions. No code',
    points: ['Starts on a new lead, a tag, or when you press start', 'Waits for a reply, checks it, tags the lead and picks the teammate', 'Stops by itself on a reply, an opt-out or a dead number'],
  },
  {
    key: 'convert', tone: 'emerald', n: 'users', short: 'Team & sales', title: 'Your team closes in one inbox', sub: 'Assigned chats, a sales board and renewals',
    points: ['Shared inbox with assignment, notes and quick replies', 'A board of leads by stage, with the deal value', 'Renewal reminders with a payment link, marked paid by themselves'],
  },
];

const DUR = 7000;

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const [hover, setHover] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.3 });
  const reduced = useReducedMotion();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const auto = !touched && !reduced;
  const paused = hover || !inView;

  const pick = (i: number, focus = false) => { setTouched(true); setActive(i); if (focus) tabs.current[i]?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { e.preventDefault(); pick((active + d + 3) % 3, true); }
    if (e.key === 'Home') { e.preventDefault(); pick(0, true); }
    if (e.key === 'End') { e.preventDefault(); pick(2, true); }
  };
  const step = STEPS[active]!;

  return (
    <Band tone="canvas" id="how" labelledBy="how-title" className="py-16 sm:py-24">
      <div className={CONTAINER}>
        <SectionHead id="how-title" tone="indigo" n="01" eyebrow="Inside the workspace" title="The screens your team" highlight="works in every day." align="center"
          lead="Three real screens from LeadBotCloud, shown with sample data. Tap one to open it." />

        <div ref={ref} className="sr-in mt-10 sm:mt-12" data-paused={paused ? '1' : '0'} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <div role="tablist" aria-label="How it works" onKeyDown={onKey} className="grid grid-cols-3 gap-2 sm:gap-3">
            {STEPS.map((s, i) => {
              const on = i === active;
              return (
                <button key={s.key} ref={(el) => { tabs.current[i] = el; }} role="tab" id={`how-tab-${s.key}`} aria-selected={on} aria-controls="how-panel" tabIndex={on ? 0 : -1} onClick={() => pick(i)}
                  className={`relative overflow-hidden text-left rounded-2xl p-3 sm:p-4 min-h-[64px] border transition-all duration-300 cursor-pointer ${on ? `bg-white dark:bg-slate-800/95 border-transparent ring-1 ${TONE[s.tone].ring} shadow-card-light dark:shadow-card-dark` : 'bg-white/50 dark:bg-slate-900/40 border-slate-900/[0.07] dark:border-white/[0.07] hover:bg-white/80 dark:hover:bg-slate-800/60'}`}>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-xl flex items-center justify-center font-jk font-extrabold text-sm ${on ? `${TONE[s.tone].dot} text-white` : 'bg-slate-900/[0.06] dark:bg-white/[0.08] text-slate-500 dark:text-slate-400'}`}><Icon name={s.n} className="w-4 h-4" /></span>
                    <div className="min-w-0">
                      <div className={`font-jk font-bold text-[13px] sm:text-[15px] tracking-[-0.01em] ${on ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                        {s.short}
                      </div>
                      <div className="hidden lg:block text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{s.sub}</div>
                    </div>
                  </div>
                  {on && auto ? (
                    <span key={`t-${active}`} className={`tab-timer absolute left-0 bottom-0 h-[3px] w-full ${TONE[s.tone].dot}`} style={{ ['--dur' as string]: `${DUR}ms` }}
                      onAnimationEnd={() => setActive((a) => (a + 1) % 3)} aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div id="how-panel" role="tabpanel" aria-labelledby={`how-tab-${step.key}`} className={`${STAGE} mt-3 sm:mt-4 p-4 sm:p-6 lg:p-8`}>
            <div className={`absolute -top-20 right-10 w-80 h-48 blur-3xl pointer-events-none ${step.tone === 'amber' ? 'bg-amber-500/[0.07]' : step.tone === 'indigo' ? 'bg-indigo-500/[0.08]' : 'bg-emerald-500/[0.08]'}`} />
            <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center">
              <div className="lg:col-span-4">
                <h3 className="font-jk font-extrabold text-[1.45rem] sm:text-[1.7rem] leading-[1.15] tracking-[-0.03em] text-slate-900 dark:text-white">{step.title}</h3>
                <ul className="mt-4 space-y-2.5">
                  {step.points.map((p) => (
                    <li key={p} className="flex gap-2.5 text-[15px] leading-[1.55] text-slate-600 dark:text-slate-300">
                      <span className={`mt-[3px] w-5 h-5 shrink-0 rounded-full flex items-center justify-center ${TONE[step.tone].soft}`}><Check className="w-3 h-3" /></span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lg:col-span-8 min-w-0" key={step.key}>
                {active === 0 ? <CaptureMock /> : active === 1 ? <QualifyMock run={inView && !reduced} /> : <ConvertMock run={inView && !reduced} />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Band>
  );
}

/* ---------------- 1. Capture ---------------- */
const LEADS = [
  { n: 'Riya Sharma', src: 'Meta Lead Ads', msg: 'Please share the 2BHK price list', t: 'now', badge: null },
  { n: 'Arjun Patel', src: 'Website button', msg: 'Is cash on delivery available?', t: '1m', badge: null },
  { n: 'Fatima Khan', src: 'IndiaMART', msg: 'Need 200 pieces, bulk rate?', t: '3m', badge: 'Duplicate merged' },
  { n: 'Karan Mehta', src: 'Shopify', msg: 'Left checkout · ₹2,340 cart', t: '6m', badge: null },
];

function CaptureMock() {
  return (
    <div className="w-full max-w-2xl mx-auto lg:mx-0 lg:ml-auto">
      <div className={`${CARD} p-3 sm:p-4 shadow-[0_30px_60px_-30px_rgba(15,23,42,0.35)] dark:shadow-card-dark`}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${TONE.amber.soft}`}><Icon name="list" className="w-4 h-4" /></span>
            <span className="text-sm font-bold text-slate-900 dark:text-white">Lead inbox</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">4 new</span>
          </div>
          <span className={SAMPLE_TAG}>Sample</span>
        </div>
        <ul className="space-y-2">
          {LEADS.map((l, i) => (
            <li key={l.n} className="animate-spring-in opacity-0 flex items-center gap-3 p-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-900/50 border border-slate-900/[0.05] dark:border-white/[0.06]"
              style={{ animationDelay: `${450 + i * 420}ms` }}>
              <span className="w-8 h-8 shrink-0 rounded-full bg-linear-to-br/srgb from-amber-400 to-amber-600 text-white text-xs font-bold flex items-center justify-center">{l.n.split(' ').map((w) => w[0]).join('')}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13px] font-bold text-slate-900 dark:text-white">{l.n}</span>
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/12 text-amber-700 dark:text-amber-300">{l.src}</span>
                  {l.badge ? <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/12 text-indigo-700 dark:text-indigo-300">{l.badge}</span> : null}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 sm:truncate mt-0.5">{l.msg}</div>
              </div>
              <span className="text-[10px] text-slate-400 shrink-0">{l.t}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-snug text-slate-500 dark:text-slate-400">A new lead is not marketing permission. Where each person agreed is recorded on its own, so promotions only go to people who said yes.</p>
      </div>
    </div>
  );
}

/* ---------------- 2. Qualify ---------------- */
function Node({ on, tone, icon, title, sub }: { on: boolean; tone: Tone | 'slate'; icon: string; title: string; sub?: string }) {
  const t = tone === 'slate' ? { soft: 'bg-slate-900/[0.06] dark:bg-white/[0.08] text-slate-500 dark:text-slate-300', ring: 'ring-slate-400/40' } : TONE[tone];
  return (
    <div className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-white dark:bg-slate-800/95 border border-slate-900/[0.08] dark:border-white/[0.08] shadow-card-light dark:shadow-card-dark transition-all duration-300 ${on ? `ring-2 ${t.ring} scale-[1.02]` : ''}`}>
      <span className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center ${t.soft}`}><Icon name={icon} className="w-4 h-4" /></span>
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-slate-900 dark:text-white leading-tight">{title}</div>
        {sub ? <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">{sub}</div> : null}
      </div>
    </div>
  );
}
function Wire({ tone = '#6366F1', h = 'h-6' }: { tone?: string; h?: string }) {
  return (
    <div className={`relative mx-auto w-2 ${h}`}>
      <div className="absolute inset-0 dash-y" />
      <span className="pkt-y" style={{ ['--pc' as string]: tone, ['--pd' as string]: '1.1s' }} />
    </div>
  );
}
function QualifyMock({ run }: { run: boolean }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!run) return;
    const id = window.setInterval(() => setS((x) => (x + 1) % 6), 1100);
    return () => window.clearInterval(id);
  }, [run]);
  return (
    <div className="relative max-w-[520px] mx-auto">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Journey: <span className="text-indigo-600 dark:text-indigo-400">New enquiry</span></span>
        <span className={SAMPLE_TAG}>Sample flow</span>
      </div>
      <Node on={s === 0} tone="amber" icon="bolt" title="When a new lead arrives" sub="From any source in step 1" />
      <Wire tone="#F59E0B" />
      <Node on={s === 1} tone="indigo" icon="send" title="Send “Thanks for your enquiry”" sub="Ready-made template, your words" />
      <Wire />
      <Node on={s === 2} tone="indigo" icon="clock" title="Wait for a reply" sub="Up to 1 day" />
      <Wire />
      <Node on={s === 3} tone="indigo" icon="split" title="Did they reply?" />
      <div className="relative h-6">
        <div className="absolute left-1/4 right-1/4 top-1/2 h-px dash-x" />
        <div className="absolute left-1/4 top-1/2 bottom-0 w-px dash-y" />
        <div className="absolute right-1/4 top-1/2 bottom-0 w-px dash-y" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div>
          <div className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Yes</div>
          <Node on={s === 4} tone="emerald" icon="tag" title="Tag “Hot”, assign Riya" />
        </div>
        <div>
          <div className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">No</div>
          <Node on={s === 5} tone="slate" icon="repeat" title="Send a follow-up" sub="Next day" />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        <Icon name="stop" className="w-3.5 h-3.5 text-rose-500" />Stops by itself on a reply, an opt-out or an unreachable number
      </div>
    </div>
  );
}

/* ---------------- 3. Convert ---------------- */
type Deal = { n: string; v: string };
function DealCard({ d, won, fresh }: { d: Deal; won?: boolean; fresh?: boolean }) {
  return (
    <div className={`${fresh ? 'animate-spring-in' : ''} p-2 sm:p-2.5 rounded-xl border ${won ? 'bg-emerald-50/80 dark:bg-emerald-500/[0.09] border-emerald-500/30' : 'bg-white dark:bg-slate-800/95 border-slate-900/[0.07] dark:border-white/[0.08]'} shadow-xs`}>
      <div className="text-[11.5px] sm:text-xs font-bold text-slate-900 dark:text-white truncate">{d.n}</div>
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <span className="text-[11px] sm:text-xs font-extrabold tabular-nums text-slate-700 dark:text-slate-200">{d.v}</span>
        {won ? <span className="inline-flex items-center gap-0.5 text-[9.5px] font-bold text-emerald-700 dark:text-emerald-300"><Check className="w-2.5 h-2.5" />Paid</span> : null}
      </div>
    </div>
  );
}
function ConvertMock({ run }: { run: boolean }) {
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (!run) { setMoved(true); return; }
    setMoved(false);
    const id = window.setInterval(() => setMoved((m) => !m), 2600);
    return () => window.clearInterval(id);
  }, [run]);
  const neha = { n: 'Neha Kapoor', v: '₹12,000' };
  const cols: { t: string; tone: Tone; deals: Deal[]; won?: boolean }[] = [
    { t: 'New', tone: 'amber', deals: [{ n: 'Arjun Patel', v: '₹4,500' }, { n: 'Sana Ali', v: '₹9,000' }] },
    { t: 'Talking', tone: 'indigo', deals: [...(moved ? [] : [neha]), { n: 'Vikram Rao', v: '₹30,000' }] },
    { t: 'Won', tone: 'emerald', deals: [...(moved ? [neha] : []), { n: 'Riya Sharma', v: '₹18,000' }], won: true },
  ];
  return (
    <div className="space-y-3">
      <div className={`${CARD} p-3 flex items-center gap-3`}>
        <span className="relative w-9 h-9 shrink-0 rounded-full bg-linear-to-br/srgb from-emerald-500 to-teal-600 text-white text-xs font-bold flex items-center justify-center">RS
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-800" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-slate-900 dark:text-white">Team inbox · Riya</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Neha Kapoor: “Okay, sending the payment now 👍”</div>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500 text-white shrink-0">Assigned</span>
      </div>

      <div className={`${CARD} p-3`}>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[13px] font-bold text-slate-900 dark:text-white">Sales board</span>
          <span className={SAMPLE_TAG}>Sample</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {cols.map((c) => (
            <div key={c.t} className="rounded-xl bg-slate-50/80 dark:bg-slate-900/50 border border-slate-900/[0.05] dark:border-white/[0.06] p-1.5 sm:p-2 min-h-[150px]">
              <div className="flex items-center gap-1.5 px-1 mb-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${TONE[c.tone].dot}`} />
                <span className="text-[10.5px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{c.t}</span>
              </div>
              <div className="space-y-1.5">
                {c.deals.map((d) => <DealCard key={d.n} d={d} won={c.won} fresh={d.n === neha.n && run} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${CARD} p-3 flex items-center gap-3`}>
        <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${TONE.emerald.soft}`}><Icon name="repeat" className="w-4 h-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-slate-900 dark:text-white">Renewal: Asha’s Gold plan ends 30 Nov</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Reminder sent with a payment link · paid, marked by itself</div>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 shrink-0"><Check className="w-3 h-3" />Paid</span>
      </div>
    </div>
  );
}

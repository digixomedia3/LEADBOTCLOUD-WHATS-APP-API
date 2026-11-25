'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Dumbbell, GraduationCap, IndianRupee, MessageCircle, MousePointer2, Pause, Play, Scissors, Send, ShieldCheck, ShoppingBag, Users } from 'lucide-react';
import { estimateCost } from '@/lib/cost';
import { cn } from '@/lib/utils';

/**
 * The hero: one campaign, start to finish, in about fifteen seconds.
 * A sample list comes in (sky), is checked (rose: people who never agreed or said stop are skipped),
 * the cost is shown and the visitor presses send (green), replies come back (violet) and some customers renew or buy (gold).
 * Every dot is a group of contacts. Counts and cost are exact for the sample (cost from lib/cost, Meta India rate);
 * replies and sales are individual sample people, never a rate or a total, so nothing here is an invented benchmark.
 */

const COLS = 12;
const ROWS = 8;
const N = COLS * ROWS;
const AGREED = 0.7; // sample: 70% of the list has a permission on record

type Sample = { at: number; who: string; text: string };
type Sale = { at: number; amount: number; text: string };
type Biz = { id: string; label: string; Icon: typeof Dumbbell; name: string; contacts: number; msg: string; replies: Sample[]; sales: Sale[] };

// Reply dots sit away from the grid edges so their bubbles never clip. Sales come from people who replied.
const R = [1 * COLS + 2, 2 * COLS + 8, 5 * COLS + 4, 6 * COLS + 9];

const BIZ: Biz[] = [
  { id: 'gym', label: 'Gym', Icon: Dumbbell, name: 'FitZone Gym', contacts: 3000, msg: 'Hi Pooja, your membership ends on Friday. Renew this week and get 7 extra days free.',
    replies: [{ at: R[0]!, who: 'Pooja', text: 'Renewing today' }, { at: R[1]!, who: 'Karan', text: '6 AM batch open?' }, { at: R[2]!, who: 'Aarav', text: 'Send the link' }, { at: R[3]!, who: 'Neha', text: 'Next month' }],
    sales: [{ at: R[0]!, amount: 1500, text: 'renewed' }, { at: R[2]!, amount: 1500, text: 'renewed' }] },
  { id: 'coaching', label: 'Coaching', Icon: GraduationCap, name: 'Rank Up Academy', contacts: 1200, msg: 'Hello Sneha, a new NEET batch starts on Monday. Want a free demo class first?',
    replies: [{ at: R[0]!, who: 'Sneha', text: 'Book a demo' }, { at: R[1]!, who: 'Rohit', text: 'Call me back' }, { at: R[2]!, who: 'Ayesha', text: 'What is the fee?' }, { at: R[3]!, who: 'Dev', text: 'Evening batch?' }],
    sales: [{ at: R[0]!, amount: 4500, text: 'seat booked' }, { at: R[2]!, amount: 4500, text: 'seat booked' }] },
  { id: 'salon', label: 'Salon', Icon: Scissors, name: 'Glow Salon', contacts: 800, msg: 'Hi Ritika, festive week at Glow: 20% off for returning clients. Shall we keep a slot for you?',
    replies: [{ at: R[0]!, who: 'Ritika', text: 'Saturday 4 PM?' }, { at: R[1]!, who: 'Simran', text: 'Book me in' }, { at: R[2]!, who: 'Farah', text: 'Bridal too?' }, { at: R[3]!, who: 'Isha', text: 'Sunday free?' }],
    sales: [{ at: R[0]!, amount: 1200, text: 'booked' }, { at: R[2]!, amount: 2000, text: 'advance paid' }] },
  { id: 'store', label: 'Online store', Icon: ShoppingBag, name: 'Kavya Store', contacts: 5000, msg: 'Hi Arjun, new arrivals are in. Past buyers get 10% off till Sunday.',
    replies: [{ at: R[0]!, who: 'Arjun', text: 'Size M left?' }, { at: R[1]!, who: 'Meera', text: 'Show kurtas' }, { at: R[2]!, who: 'Kabir', text: 'Send the link' }, { at: R[3]!, who: 'Tara', text: 'COD available?' }],
    sales: [{ at: R[0]!, amount: 1299, text: 'ordered' }, { at: R[2]!, amount: 2499, text: 'ordered' }] },
];

// A fixed shuffle (same on server and browser), so skipped dots scatter instead of forming blocks.
const KINDS = (() => {
  const free = Array.from({ length: N }, (_, i) => i).filter((i) => !R.includes(i));
  let s = 7;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [free[i], free[j]] = [free[j]!, free[i]!]; }
  const skip = new Set(free.slice(0, Math.round(N * (1 - AGREED))));
  return Array.from({ length: N }, (_, i) => (skip.has(i) ? 'skip' : R.includes(i) ? 'reply' : 'reach'));
})();

const STEPS = [
  { id: 'list', label: 'Your list', Icon: Users },
  { id: 'check', label: 'Checked', Icon: ShieldCheck },
  { id: 'send', label: 'Sent', Icon: Send },
  { id: 'reply', label: 'Replies', Icon: MessageCircle },
  { id: 'sale', label: 'Sales', Icon: IndianRupee },
] as const;
// Phase 2 is the cost review before sending; it belongs to the "Sent" step.
const STEP_OF_PHASE = [0, 1, 2, 2, 3, 4];
const PHASE_OF_STEP = [0, 1, 2, 4, 5];
const HOLD = [1900, 2400, 2700, 2100, 2900, 4600];

const fmt = (n: number) => n.toLocaleString('en-IN');

export function HeroEngine() {
  const [b, setB] = useState(0);
  const [phase, setPhase] = useState(0);
  const [round, setRound] = useState(0);
  const [auto, setAuto] = useState(true);
  const [still, setStill] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);

  const biz = BIZ[b]!;
  const reach = Math.round(biz.contacts * AGREED);
  const skipped = biz.contacts - reach;
  const cost = estimateCost(reach, 'marketing');
  const sold = useMemo(() => new Set(biz.sales.map((s) => s.at)), [biz]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setStill(true); setAuto(false); setPhase(5); }
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    const vis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', vis);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }, []);

  // The loop. Pauses off screen, in a background tab, and once the visitor takes control.
  useEffect(() => {
    if (!auto || still || !visible) return;
    const t = window.setTimeout(() => {
      if (phase >= 5) { setRound((r) => r + 1); setPhase(0); } else setPhase(phase + 1);
    }, HOLD[phase]);
    return () => window.clearTimeout(t);
  }, [phase, auto, still, visible]);

  const restart = useCallback((nb: number) => { setB(nb); setRound((r) => r + 1); setPhase(still ? 5 : 0); }, [still]);
  const jump = (step: number) => { setAuto(false); setPhase(PHASE_OF_STEP[step]!); };
  const send = () => { if (phase === 2) setPhase(3); };
  const toggle = () => { if (auto) { setAuto(false); return; } if (phase >= 5) { setRound((r) => r + 1); setPhase(0); } setAuto(true); };

  const onChipKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); const n = (b + d + BIZ.length) % BIZ.length; restart(n); chips.current[n]?.focus();
  };

  const step = STEP_OF_PHASE[phase]!;
  const caption = [
    `Your contact list comes in: ${fmt(biz.contacts)} people.`,
    `Checked first: ${fmt(skipped)} never agreed or said stop, so they are skipped.`,
    `You see the exact cost before anything goes out. Press send.`,
    `${fmt(reach)} messages go out from your own WhatsApp number.`,
    'Replies land in one inbox your whole team can answer.',
    'Customers renew and buy, right from the chat.',
  ][phase]!;
  const stat = [fmt(biz.contacts), `${fmt(skipped)} skipped`, cost.totalLabel, 'Team inbox', 'Paid'];

  const at = (i: number) => ({ left: `${((i % COLS) + 0.5) * (100 / COLS)}%`, top: `${(Math.floor(i / COLS) + 0.5) * (100 / ROWS)}%` });

  return (
    <div ref={root} className="he relative rounded-[1.75rem] border border-white/12 bg-[#081726]/85 p-3 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.8)] sm:p-5" data-still={still}>
      {/* Business picker + play control */}
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Sample business" onKeyDown={onChipKey} className="he-chips -ml-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pl-1 pr-6 [scrollbar-width:none] sm:pr-1">
          {BIZ.map((x, n) => (
            <button key={x.id} ref={(el) => { chips.current[n] = el; }} type="button" aria-pressed={n === b} onClick={() => restart(n)}
              className={cn('inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition sm:text-sm', n === b ? 'bg-white text-[#0a1a2a]' : 'bg-white/[0.07] text-white/80 hover:bg-white/15')}>
              <x.Icon className="size-4" />{x.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={toggle} hidden={still} aria-label={auto ? 'Pause the demo' : 'Play the demo'} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white/85 transition hover:bg-white/15">
          {auto ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
      </div>

      {/* Step rail: the legend, the progress and a scrubber in one */}
      <ol className="mt-3 grid grid-cols-5 gap-1 sm:mt-4 sm:gap-2">
        {STEPS.map((s, n) => {
          const done = n < step || (n === step && phase === 5);
          const on = n === step;
          return (
            <li key={s.id} className="min-w-0">
              <button type="button" onClick={() => jump(n)} aria-current={on ? 'step' : undefined} aria-label={`${s.label}: show this step`}
                className={cn('he-step group flex min-h-11 w-full flex-col items-start rounded-xl px-1.5 py-1.5 text-left transition sm:px-2.5 sm:py-2', on ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]')} data-c={s.id}>
                <span className="relative block h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <span className={cn('he-fill absolute inset-y-0 left-0 rounded-full', done ? 'w-full' : on ? 'he-fill-run' : 'w-0')} key={`${round}-${phase}-${n}`} style={on && !done && auto && !still ? { ['--t' as string]: `${HOLD[phase]}ms` } : undefined} />
                </span>
                <span className={cn('mt-1.5 flex items-center gap-1 text-[11px] font-semibold sm:text-xs', n <= step ? 'text-white' : 'text-white/45')}><s.Icon className="he-ink hidden size-3.5 shrink-0 sm:block" />{s.label}</span>
                <span className={cn('hidden truncate font-display text-sm font-extrabold tabular-nums transition sm:block', n <= step ? 'he-ink opacity-100' : 'opacity-0')} style={{ maxWidth: '100%' }}>{stat[n]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* The list */}
      <div className="relative mt-3 rounded-2xl bg-black/25 px-3 py-4 sm:mt-4 sm:px-6 sm:py-6">
        <div key={round} className={cn('he-grid relative grid', phase >= 1 && 'p1', phase >= 3 && 'p3', phase >= 4 && 'p4', phase >= 5 && 'p5')}
          style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }} role="img"
          aria-label={`Sample list of ${fmt(biz.contacts)} contacts: ${fmt(skipped)} skipped, ${fmt(reach)} messaged for ${cost.totalLabel} with GST. Each dot is a group of contacts.`}>
          {KINDS.map((k, i) => (
            <span key={i} className="he-cell"><i className="he-dot" data-k={k} data-sale={sold.has(i) ? '' : undefined} style={{ ['--c' as string]: i % COLS, ['--r' as string]: Math.floor(i / COLS) }} /></span>
          ))}

          {/* Sweeps: the check, then the send */}
          {(phase === 1 || phase === 3) && !still ? <span aria-hidden="true" className="pointer-events-none absolute -inset-y-2 inset-x-0 overflow-hidden"><span className={cn('he-beam', phase === 1 ? 'he-beam-check' : 'he-beam-send')} /></span> : null}

          {/* Replies rise from the people who answered */}
          {phase >= 4 ? biz.replies.map((r, n) => (
            <span key={`${round}-r-${r.at}`} aria-hidden="true" className="he-bubble" style={{ ...at(r.at), ['--o' as string]: n }}>
              <b>{r.who}</b>{r.text}
            </span>
          )) : null}
          {/* Sales land under the people who bought */}
          {phase >= 5 ? biz.sales.map((s, n) => (
            <span key={`${round}-s-${s.at}`} aria-hidden="true" className="he-sale" style={{ ...at(s.at), ['--o' as string]: n }}>
              <IndianRupee className="size-3" />{fmt(s.amount)} <span className="font-medium opacity-80">{s.text}</span>
            </span>
          )) : null}
        </div>

        {/* Cost review: nothing goes out until you press send */}
        {phase === 2 ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-3">
            <div className="he-pop w-full max-w-[17.5rem] rounded-2xl bg-white p-4 text-[#0b1020] shadow-2xl">
              <p className="text-xs font-semibold text-[#5b6478]">Ready to send to {fmt(reach)} people</p>
              <p className="mt-0.5 font-display text-3xl font-extrabold tabular-nums">{cost.totalLabel}</p>
              <p className="text-xs text-[#5b6478]">with GST, paid to Meta. No markup from us.</p>
              <div className="relative mt-3">
                <button type="button" onClick={send} className={cn('lp-wa-btn flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-bold', auto && !still && 'he-press')}>
                  <Send className="size-4" />Send to {fmt(reach)}
                </button>
                {auto && !still ? <MousePointer2 aria-hidden="true" className="he-cursor pointer-events-none absolute right-8 top-6 size-6 fill-white text-[#0b1020]" /> : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* What each customer receives */}
        {phase === 3 ? (
          <div className="he-pop absolute bottom-3 right-3 z-10 w-[min(16rem,calc(100%-1.5rem))] overflow-hidden rounded-2xl bg-[#efe7dd] shadow-2xl">
            <p className="flex items-center gap-2 bg-[#075e54] px-3 py-2 text-xs font-semibold text-white"><span className="flex size-6 items-center justify-center rounded-full bg-white/20 text-[11px]">{biz.name[0]}</span>{biz.name}</p>
            <div className="p-2"><div className="rounded-lg rounded-tl-none bg-white p-2 text-[12.5px] leading-snug text-[#111b21] shadow-sm">{biz.msg}<span className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-black/45">10:30 AM<CheckCheck className="size-3.5 text-[#53bdeb]" /></span></div></div>
          </div>
        ) : null}
      </div>

      {/* Narration */}
      <p className="mt-3 flex min-h-12 items-center gap-2.5 px-1 text-sm font-semibold text-white sm:text-base" aria-live="polite">
        <span className="he-ink-dot size-2.5 shrink-0 rounded-full" data-c={STEPS[step]!.id} />{caption}
      </p>
      <p className="px-1 text-[11px] text-white/50">Sample business and names. Each dot is a group of contacts; 70% agreed in this sample. Cost uses Meta’s India rate.</p>
    </div>
  );
}

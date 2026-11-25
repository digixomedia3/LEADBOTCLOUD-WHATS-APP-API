'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Check, CheckCheck, MessageCircle, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = [
  { c: 'list', Icon: CalendarClock, t: 'Expiry date saved', d: 'Once, from your list or a sheet.' },
  { c: 'send', Icon: Send, t: 'Reminder goes out', d: 'Before the date, by itself, with your words.' },
  { c: 'reply', Icon: MessageCircle, t: 'Customer answers', d: 'They tap Renew, ask a question, or pay.' },
  { c: 'sale', Icon: Check, t: 'Marked renewed', d: 'Thank-you sent, next date set. Overdue ones stay on your list.' },
] as const;

const R = 112; // ring radius in the 300×300 drawing
const C = 2 * Math.PI * R;
const node = (n: number) => { const a = (n * Math.PI) / 2 - Math.PI / 2; return { x: 150 + R * Math.cos(a), y: 150 + R * Math.sin(a) }; };

/** The renewal engine as a loop that never needs you: date → reminder → answer → renewed → (next month) date again. Sample customer. */
export function RenewalLoop() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const [loops, setLoops] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setAuto(false); setI(3); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!auto || !visible) return;
    const t = window.setTimeout(() => { if (i === 3) setLoops((l) => l + 1); setI((i + 1) % 4); }, i === 3 ? 3400 : 2500);
    return () => window.clearTimeout(t);
  }, [i, auto, visible]);

  // The token keeps travelling forward round the ring, loop after loop.
  const turn = (loops * 4 + i) * 90;

  return (
    <div ref={ref} className="rl grid items-center gap-10 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16">
      <div className="relative mx-auto w-full max-w-[21rem] sm:max-w-[24rem]">
        <svg viewBox="0 0 300 300" className="block w-full" role="img" aria-label={`Renewal loop, step ${i + 1} of 4: ${STEPS[i]!.t}`}>
          <defs>
            <linearGradient id="rl-arc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="0.35" stopColor="#25d366" /><stop offset="0.7" stopColor="#a78bfa" /><stop offset="1" stopColor="#fbbf24" /></linearGradient>
          </defs>
          <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="10" />
          <circle cx="150" cy="150" r={R} fill="none" stroke="url(#rl-arc)" strokeWidth="10" strokeLinecap="round" transform="rotate(-90 150 150)"
            strokeDasharray={C} strokeDashoffset={C - (C * (i + (i === 3 ? 1 : 0.15))) / 4} className="rl-arc" />
          <g className="rl-token" style={{ transform: `rotate(${turn}deg)` }}><circle cx="150" cy={150 - R} r="7" fill="#fff" /><circle cx="150" cy={150 - R} r="13" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" /></g>
        </svg>
        {STEPS.map((s, n) => {
          const p = node(n);
          return (
            <span key={s.c} data-c={s.c} aria-hidden="true" className={cn('rl-node absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition duration-500', n <= i ? 'rl-on' : '')} style={{ left: `${(p.x / 300) * 100}%`, top: `${(p.y / 300) * 100}%` }}>
              <s.Icon className="size-5" />
            </span>
          );
        })}
        {/* Centre: the same customer, moving through the loop */}
        <div className="absolute inset-[24%] flex flex-col items-center justify-center text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-white/12 font-display text-lg font-semibold">A</span>
          <p className="mt-1.5 text-sm font-semibold">Aarav K.</p>
          <p className="text-[11px] text-white/60">Gym, monthly · ₹1,500</p>
          <p key={i} data-c={STEPS[i]!.c} className="rl-pill he-pop mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold">
            {['Ends Friday', 'Reminder sent', '“Renew now”', 'Renewed till 15 Jan'][i]}{i === 1 ? <CheckCheck className="size-3.5" /> : null}
          </p>
        </div>
      </div>

      <div>
        <ol className="space-y-2">
          {STEPS.map((s, n) => (
            <li key={s.c}>
              <button type="button" data-c={s.c} onClick={() => { setAuto(false); setI(n); }} aria-current={n === i ? 'step' : undefined}
                className={cn('rl-row flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition', n === i ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]')}>
                <span className={cn('rl-node flex size-10 shrink-0 items-center justify-center rounded-xl', n <= i && 'rl-on')}><s.Icon className="size-4.5" /></span>
                <span className="leading-tight"><span className="block text-base font-semibold tracking-[-0.01em] sm:text-[17px]">{s.t}</span><span className={cn('block text-sm text-white/65', n !== i && 'hidden sm:block')}>{s.d}</span></span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

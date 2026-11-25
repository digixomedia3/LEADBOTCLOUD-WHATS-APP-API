'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Ban, CalendarClock, Check, CheckCheck, Gauge, MessageSquareWarning, RefreshCw } from 'lucide-react';
import { PLAN_LIMITS } from '@lbc/shared';
import { estimateCost } from '@/lib/cost';
import { cn } from '@/lib/utils';

const fmt = (n: number) => n.toLocaleString('en-IN');
const thousand = estimateCost(1000, 'marketing');
const updates = estimateCost(1000, 'utility');

/** Plays its small animations once, the first time the grid scrolls into view. Without JS or with reduced motion it shows the end state. */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setInView(true); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

function Tile({ c, q, title, children, className }: { c: 'list' | 'check' | 'send' | 'reply' | 'sale'; q: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div data-c={c} className={cn('qa-tile sr flex flex-col rounded-2xl p-5 sm:p-7', className)}>
      <p className="qa-q text-[13px]">{q}</p>
      <h3 className="mt-1.5 text-xl font-semibold leading-snug tracking-[-0.02em] sm:text-[1.375rem]">{title}</h3>
      <div className="mt-5 flex-1">{children}</div>
    </div>
  );
}

/** The five questions every buyer asks, each answered with a picture instead of a paragraph. Colours match the hero's stages. */
export function BuyerAnswers() {
  const [ref, on] = useInView<HTMLDivElement>();
  const growth = PLAN_LIMITS.growth.contacts;
  return (
    <div ref={ref} data-on={on} className="qa grid gap-4 lg:grid-cols-3">
      {/* Reach */}
      <Tile c="list" q="Will it reach all my customers?" title="Everyone who agreed. Not just 256." className="lg:col-span-2">
        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-semibold text-muted">Free WhatsApp Business app</span><span className="text-lg tracking-[-0.02em] font-semibold tabular-nums text-muted">256</span></div>
            <div className="relative mt-1.5 h-4 rounded-full bg-ink/[0.07]"><span className="qa-bar absolute inset-y-0 left-0 rounded-full bg-ink/25" style={{ ['--w' as string]: '9%' }} /><span className="absolute -top-1 bottom-[-4px] left-[9%] w-0.5 rounded bg-ink/50" aria-hidden="true" /></div>
            <p className="t-cap mt-1 text-muted">A broadcast stops at 256, and only reaches people who saved your number.</p>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-semibold">LeadBotCloud</span><span className="qa-ink text-lg tracking-[-0.02em] font-semibold tabular-nums">{fmt(growth)}</span></div>
            <div className="relative mt-1.5 h-4 rounded-full bg-ink/[0.07]"><span className="qa-bar qa-fill absolute inset-y-0 left-0 rounded-full" style={{ ['--w' as string]: '100%' }} /></div>
            <p className="t-cap mt-1 text-muted">Your whole list, up to your plan’s limit ({fmt(growth)} contacts on Growth). Only people with a permission on record get a message.</p>
          </div>
        </div>
      </Tile>

      {/* Cost */}
      <Tile c="send" q="What will it cost me?" title="The exact amount, before you send.">
        <dl className="qa-receipt rounded-xl bg-card2 p-4 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">1,000 promotional messages</dt><dd className="tabular-nums">{thousand.baseLabel}</dd></div>
          <div className="mt-1 flex justify-between gap-3"><dt className="text-muted">GST 18%</dt><dd className="tabular-nums">{thousand.gstLabel}</dd></div>
          <div className="mt-2 flex justify-between gap-3 border-t border-dashed border-line pt-2 font-semibold"><dt>Total, paid to Meta</dt><dd className="qa-ink text-lg tracking-[-0.02em] font-semibold tabular-nums">{thousand.totalLabel}</dd></div>
        </dl>
        <p className="t-cap mt-3 text-muted">No markup from us. Updates such as reminders cost {updates.totalLabel} per 1,000 with GST.</p>
      </Tile>

      {/* Safety */}
      <Tile c="check" q="Will my number get blocked?" title="Checked before every send.">
        <div className="flex items-center gap-3">
          <Gauge className="qa-ink size-6 shrink-0" />
          <div className="grid flex-1 grid-cols-3 gap-1 text-center text-[11px] font-semibold">
            <span className="qa-safe rounded-l-full py-1.5">Safe</span><span className="rounded-none bg-amber/15 py-1.5 text-muted">Careful</span><span className="rounded-r-full bg-rose/10 py-1.5 text-muted">Stop sending</span>
          </div>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {[[Ban, 'People who said stop are never messaged'], [CalendarClock, 'Your daily sending limit is checked'], [MessageSquareWarning, 'Templates checked for common rejections']].map(([I, t], n) => {
            const Icon = I as typeof Ban;
            return <li key={n} className="qa-check flex items-center gap-2.5" style={{ ['--o' as string]: n }}><span className="qa-chip flex size-7 shrink-0 items-center justify-center rounded-full"><Icon className="size-3.5" /></span>{t as string}</li>;
          })}
        </ul>
        <p className="t-cap mt-3 text-muted">Meta has the final say on any account. We lower the risk and warn you early.</p>
      </Tile>

      {/* Team */}
      <Tile c="reply" q="Can my staff handle the replies?" title="One inbox for the whole team.">
        <ul className="space-y-2">
          {[['R', 'Ritika S.', 'Send me the link', 'You'], ['A', 'Arjun M.', 'Booked for Monday', 'Rahul'], ['S', 'Sana P.', 'Open on Sunday?', 'Priya']].map(([i, n, m, who], k) => (
            <li key={n} className="qa-msg flex items-center gap-3 rounded-xl bg-card2 p-2.5" style={{ ['--o' as string]: k }}>
              <span className="qa-avatar flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">{i}</span>
              <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-sm font-semibold">{n}</span><span className="block truncate text-xs text-muted">{m}</span></span>
              <span className="qa-tag shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold">{who}</span>
            </li>
          ))}
        </ul>
        <p className="t-cap mt-3 text-muted">Sample names. Assign chats, leave private notes, reply from any phone.</p>
      </Tile>

      {/* Money */}
      <Tile c="sale" q="Will it bring money back?" title="Renewals that remind themselves.">
        <ol className="flex flex-col gap-2 text-sm">
          {[[CalendarClock, 'Plan ends Friday', 'Saved once, from your list'], [CheckCheck, 'Reminder goes out', 'On schedule, by itself'], [RefreshCw, 'Renewed', 'You see who paid and who still owes']].map(([I, t, d], n) => {
            const Icon = I as typeof Check;
            return (
              <li key={n} className="qa-step flex items-center gap-3" style={{ ['--o' as string]: n }}>
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', n === 2 ? 'qa-solid' : 'qa-chip')}><Icon className="size-4" /></span>
                <span className="leading-tight"><span className="block font-semibold">{t as string}</span><span className="block text-xs text-muted">{d as string}</span></span>
              </li>
            );
          })}
        </ol>
        <a href="#renewals" className="qa-ink mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline">See the renewal loop<ArrowRight className="size-4" /></a>
      </Tile>
    </div>
  );
}

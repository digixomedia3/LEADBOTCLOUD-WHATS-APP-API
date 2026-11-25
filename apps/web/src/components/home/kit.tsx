import type { ReactNode } from 'react';

/** Shared building blocks for the homepage, taken from the hero's visual language (pill eyebrow, Jakarta display type,
 *  white glass stage, card shadow). Colour jobs: amber = capture, indigo = qualify, emerald = convert/money/safe, rose = skipped. */
export type Tone = 'amber' | 'indigo' | 'emerald' | 'rose';

export const TONE = {
  amber: { dot: 'bg-amber-500', soft: 'bg-amber-500/12 dark:bg-amber-400/15 text-amber-600 dark:text-amber-400', ring: 'ring-amber-500/35', text: 'text-amber-700 dark:text-amber-300', hex: '#F59E0B' },
  indigo: { dot: 'bg-indigo-500', soft: 'bg-indigo-500/12 dark:bg-indigo-400/15 text-indigo-600 dark:text-indigo-400', ring: 'ring-indigo-500/35', text: 'text-indigo-700 dark:text-indigo-300', hex: '#6366F1' },
  emerald: { dot: 'bg-emerald-500', soft: 'bg-emerald-500/12 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-500/35', text: 'text-emerald-700 dark:text-emerald-300', hex: '#10B981' },
  rose: { dot: 'bg-rose-500', soft: 'bg-rose-500/12 dark:bg-rose-400/15 text-rose-600 dark:text-rose-400', ring: 'ring-rose-500/35', text: 'text-rose-700 dark:text-rose-300', hex: '#F43F5E' },
} as const;

export const CONTAINER = 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8';
export const STAGE =
  'relative rounded-[28px] bg-white/80 dark:bg-slate-900/60 border border-slate-900/[0.08] dark:border-white/[0.09] shadow-card-light dark:shadow-card-dark overflow-hidden';
export const CARD = 'rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-900/[0.08] dark:border-white/[0.08] shadow-card-light dark:shadow-card-dark';
export const GRAD_TEXT =
  'bg-linear-to-r/srgb from-[#059669] via-[#10B981] to-[#0D9488] dark:from-emerald-400 dark:via-emerald-300 dark:to-teal-300 bg-clip-text text-transparent';
export const BTN_PRIMARY =
  'btn-sheen group inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-linear-to-b/srgb from-[#10B981] to-[#059669] hover:from-[#12c78b] hover:to-[#04885e] text-white font-semibold text-[15px] whitespace-nowrap shadow-cta-emerald transition-all duration-200 active:scale-[0.98]';
export const BTN_SECONDARY =
  'group inline-flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-white dark:bg-slate-900/80 text-slate-800 dark:text-slate-100 font-semibold text-[15px] whitespace-nowrap border border-slate-900/[0.11] dark:border-white/[0.12] shadow-xs hover:border-emerald-500/50 dark:hover:border-emerald-400/50 hover:bg-emerald-50/40 dark:hover:bg-emerald-500/10 transition-all duration-200 active:scale-[0.98]';
export const SAMPLE_TAG =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-slate-900/[0.05] dark:bg-white/[0.07] text-slate-500 dark:text-slate-400';

/**
 * Page rhythm. Every section sits in a full-width band so sections never blur into each other:
 *  canvas = the hero's dotted canvas (transparent, the fixed glow shows through), paper = solid white band,
 *  night = a dark band (adds the `dark` class, so every `dark:` style inside applies even in light mode).
 * Bands are separated by a hairline; a centred gradient rule marks the top of the paper and night bands.
 */
export type BandTone = 'canvas' | 'paper' | 'night';
const BAND: Record<BandTone, string> = {
  canvas: 'relative',
  paper: 'relative bg-white dark:bg-[#0A0F1A] border-y border-slate-900/[0.07] dark:border-white/[0.07]',
  night: 'dark relative isolate overflow-hidden bg-[#070B14] text-slate-100 border-y border-white/[0.06]',
};
export function Band({ tone, id, labelledBy, className = '', children }: { tone: BandTone; id?: string; labelledBy?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`${BAND[tone]} scroll-mt-16 ${className}`}>
      {tone !== 'canvas' ? <div className="absolute inset-x-0 -top-px h-px bg-linear-to-r/srgb from-transparent via-emerald-500/50 to-transparent pointer-events-none" aria-hidden="true" /> : null}
      {tone === 'night' ? (
        <div className="absolute inset-0 -z-10 pointer-events-none" aria-hidden="true">
          <div className="absolute inset-0 bg-dot-grid opacity-70" />
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[760px] h-[420px] rounded-full bg-emerald-500/[0.13] blur-[120px]" />
          <div className="absolute -bottom-40 -left-20 w-[520px] h-[380px] rounded-full bg-indigo-600/[0.14] blur-[120px]" />
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Eyebrow({ tone, children, n }: { tone: Tone; children: ReactNode; n?: string }) {
  return (
    <div className="inline-flex items-center gap-2 pl-1.5 pr-3.5 py-1 rounded-full bg-white dark:bg-slate-900/90 border border-slate-900/[0.08] dark:border-white/[0.1] shadow-xs">
      {n ? <span className={`min-w-6 h-6 px-1.5 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums ${TONE[tone].soft}`}>{n}</span> : <span className={`ml-1.5 w-2 h-2 rounded-full ${TONE[tone].dot}`} />}
      <span className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200">{children}</span>
    </div>
  );
}

/** Section heading. `split` (default) puts the title left and the lead right on desktop, bottom-aligned, so wide screens
 *  are used instead of leaving the right half empty. `center` is for sections that open with a full-width demo. */
export function SectionHead({ tone, eyebrow, n, title, highlight, lead, align = 'split', id, action }: { tone: Tone; eyebrow: string; n?: string; title: string; highlight: string; lead?: ReactNode; align?: 'split' | 'center'; id?: string; action?: ReactNode }) {
  const h2 = (
    <h2 id={id} className="mt-4 font-jk font-extrabold text-[1.95rem] sm:text-[2.4rem] lg:text-[2.65rem] leading-[1.08] tracking-[-0.035em] text-[#0F172A] dark:text-white text-balance">
      {title} <span className={GRAD_TEXT}>{highlight}</span>
    </h2>
  );
  if (align === 'center') {
    return (
      <div className="sr-in flex flex-col items-center text-center mx-auto max-w-3xl">
        <Eyebrow tone={tone} n={n}>{eyebrow}</Eyebrow>
        {h2}
        {lead ? <p className="mt-4 text-[1.02rem] sm:text-[1.08rem] leading-[1.65] text-[#475569] dark:text-slate-400 max-w-[620px]">{lead}</p> : null}
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    );
  }
  return (
    <div className="sr-in grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-10 items-end">
      <div className="lg:col-span-7">
        <Eyebrow tone={tone} n={n}>{eyebrow}</Eyebrow>
        {h2}
      </div>
      {lead || action ? (
        <div className="lg:col-span-5 lg:pb-1.5">
          {lead ? <p className="text-[1.02rem] sm:text-[1.06rem] leading-[1.65] text-[#475569] dark:text-slate-400">{lead}</p> : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Arrow({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} transition-transform duration-200 group-hover:translate-x-1`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function Check({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Cross({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Small line icons, drawn on a 24px grid like the hero's. */
export function Icon({ name, className = 'w-4 h-4' }: { name: string; className?: string }) {
  const p: Record<string, ReactNode> = {
    bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
    form: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 9h10M7 13h6" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3h2.6l2.4 12.2h11.2L21 7H6.2" /></>,
    sheet: <><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M4 9h16M4 15h16M10 3v18" /></>,
    store: <><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5.5 12.5V20h13v-7.5" /></>,
    upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
    qr: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1" /><path d="M14 14h2.5v2.5M20.5 14v6.5H14v-3" /></>,
    hook: <><path d="M9 7a3 3 0 1 1 3 3v4a3 3 0 1 0 3 3" /><circle cx="12" cy="7" r="0.5" /></>,
    chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>,
    phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>,
    rupee: <><path d="M7 4.5h10M7 9h10M9.5 4.5c3.5 0 5.5 1.6 5.5 4.5S13 13.5 9.5 13.5H7l7.5 7" /></>,
    flask: <><path d="M9.5 3h5M10.5 3v6L5 18.6A1.6 1.6 0 0 0 6.4 21h11.2a1.6 1.6 0 0 0 1.4-2.4L13.5 9V3" /><path d="M7.5 15h9" /></>,
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.2c2.4.2 4 1.8 4.5 4.3" /></>,
    tag: <><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0L3.5 12.2z" /><circle cx="8" cy="8" r="1.4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
    split: <><path d="M6 3v6a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4" /><path d="M18 3v6" /><path d="m15 6 3-3 3 3" /><path d="M6 21v-4" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    stop: <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>,
    doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
    gauge: <><path d="M4.5 18a8.5 8.5 0 1 1 15 0" /><path d="m12 13.5 4-4.5" /><circle cx="12" cy="13.5" r="1.2" /></>,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
    repeat: <><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13" /></>,
    gift: <><rect x="3.5" y="8" width="17" height="4.5" rx="1" /><path d="M5 12.5V20h14v-7.5M12 8v12" /><path d="M12 8C10 4.5 6.5 4.8 7 7c.3 1 2.5 1 5 1Zm0 0c2-3.5 5.5-3.2 5-1-.3 1-2.5 1-5 1Z" /></>,
    truck: <><path d="M2.5 6h11v10h-11zM13.5 9.5h4l3.5 3.5v3h-7.5" /><circle cx="6.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
    lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  };
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name] ?? null}
    </svg>
  );
}

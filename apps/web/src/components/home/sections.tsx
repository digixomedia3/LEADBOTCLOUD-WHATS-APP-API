import Link from 'next/link';
import { Arrow, BTN_PRIMARY, BTN_SECONDARY, CONTAINER, Check, Icon, STAGE, SectionHead, TONE, type Tone } from './kit';
import { Logo } from './site-header';

/* ---------------- Trust strip (right under the hero) ---------------- */
const TRUST: { icon: string; tone: Tone; t: string; d: string; live?: boolean }[] = [
  { icon: 'shield', tone: 'emerald', t: 'Official WhatsApp Business Platform', d: 'Meta’s Cloud API, connected through Meta’s own signup.' },
  { icon: 'phone', tone: 'indigo', t: 'Your number, your account', d: 'The WhatsApp account and chat history stay yours.' },
  { icon: 'rupee', tone: 'amber', t: 'No markup on messages', d: 'Meta bills its charges to you. We charge a flat plan.' },
  { icon: 'flask', tone: 'amber', t: 'Open to try, test mode', d: 'The full panel is free to try. Live sending switches on with Meta’s approval.', live: true },
];

export function TrustStrip() {
  return (
    <div className={`${CONTAINER} -mt-4 sm:-mt-6 lg:-mt-8 pb-4`}>
      <div className="sr-in grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 rounded-[22px] bg-white/80 dark:bg-slate-900/60 border border-slate-900/[0.08] dark:border-white/[0.09] shadow-card-light dark:shadow-card-dark overflow-hidden divide-y sm:divide-y-0 divide-slate-900/[0.06] dark:divide-white/[0.07]">
        {TRUST.map((x, i) => (
          <div key={x.t} className={`flex gap-3 p-4 sm:p-5 ${i % 2 === 1 ? 'sm:border-l' : ''} ${i >= 2 ? 'sm:border-t lg:border-t-0' : ''} ${i === 2 ? 'lg:border-l' : ''} border-slate-900/[0.06] dark:border-white/[0.07]`}>
            <span className={`relative w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${TONE[x.tone].soft}`}>
              <Icon name={x.icon} className="w-[18px] h-[18px]" />
              {x.live ? <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" /></span> : null}
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-bold leading-snug text-slate-900 dark:text-white">{x.t}</div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">{x.d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- FAQ ---------------- */
export function Faq({ faqs, waHref }: { faqs: [string, string][]; waHref: string | null }) {
  return (
    <section id="faq" className="scroll-mt-20 py-16 sm:py-24" aria-labelledby="faq-title">
      <div className={`${CONTAINER} grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12`}>
        <div className="lg:col-span-4 lg:sticky lg:top-24 self-start">
          <SectionHead id="faq-title" tone="indigo" eyebrow="Questions" title="Before you" highlight="sign up."
            lead="Straight answers, including what is not switched on yet." />
          {waHref ? (
            <a href={waHref} target="_blank" rel="noopener noreferrer" className={`${BTN_SECONDARY} sr-in mt-7 w-full sm:w-auto`}>
              <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><Icon name="chat" className="w-3 h-3" /></span>
              Ask us on WhatsApp
            </a>
          ) : null}
        </div>
        <div className="lg:col-span-8 space-y-2.5">
          {faqs.map(([q, a]) => (
            <details key={q} className="sr-in group rounded-2xl bg-white/80 dark:bg-slate-900/60 border border-slate-900/[0.08] dark:border-white/[0.09] open:bg-white open:dark:bg-slate-800/90 open:shadow-card-light open:dark:shadow-card-dark transition-colors">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 sm:px-5 py-3.5 text-[15px] font-semibold text-slate-900 dark:text-white">
                {q}
                <span className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center bg-slate-900/[0.05] dark:bg-white/[0.07] text-slate-500 dark:text-slate-300 transition-transform duration-300 group-open:rotate-45" aria-hidden="true">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </summary>
              <p className="px-4 sm:px-5 pb-5 -mt-1 text-[14.5px] leading-[1.65] text-slate-600 dark:text-slate-400">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Closing CTA ---------------- */
export function FinalCta({ ctaHref, ctaLabel, waHref }: { ctaHref: string; ctaLabel: string; waHref: string | null }) {
  const pills: [Tone, string][] = [['amber', '1. Capture'], ['indigo', '2. Qualify'], ['emerald', '3. Convert']];
  return (
    <section id="final-cta" className="pb-16 sm:pb-24" aria-labelledby="final-title">
      <div className={CONTAINER}>
        <div className={`sr-in ${STAGE} px-5 py-12 sm:px-10 sm:py-16 text-center`}>
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[420px] h-52 bg-indigo-500/[0.08] dark:bg-indigo-500/[0.14] blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 right-10 w-80 h-48 bg-emerald-500/[0.1] dark:bg-emerald-500/[0.14] blur-3xl pointer-events-none" />
          <div className="absolute inset-0 bg-dot-grid opacity-60 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-center gap-1 sm:gap-2">
              {pills.map(([t, l], i) => (
                <div key={l} className="flex items-center gap-1 sm:gap-2">
                  <span className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-semibold whitespace-nowrap ring-1 ${TONE[t].ring} ${TONE[t].soft}`}>
                    <Check className="w-3 h-3" />{l}
                  </span>
                  {i < 2 ? <svg className="hidden sm:block w-3.5 h-3.5 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg> : null}
                </div>
              ))}
            </div>
            <h2 id="final-title" className="mt-6 font-jk font-extrabold text-[2.1rem] sm:text-[3rem] lg:text-[3.4rem] leading-[1.06] tracking-[-0.035em] text-[#0F172A] dark:text-white text-balance max-w-3xl mx-auto">
              Your next sale is already <span className="bg-linear-to-r/srgb from-[#059669] via-[#10B981] to-[#0D9488] dark:from-emerald-400 dark:via-emerald-300 dark:to-teal-300 bg-clip-text text-transparent">in your chats.</span>
            </h2>
            <p className="mt-5 text-[1.02rem] sm:text-[1.08rem] leading-[1.65] text-[#475569] dark:text-slate-400 max-w-xl mx-auto">
              Make a free workspace in a minute. Bring in your leads, pick a flow, and see the cost before you spend a rupee.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-3.5">
              <Link href={ctaHref} className={BTN_PRIMARY}>{ctaLabel}<Arrow /></Link>
              {waHref ? (
                <a href={waHref} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
                  <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><Icon name="chat" className="w-3 h-3" /></span>
                  Talk to us on WhatsApp
                </a>
              ) : null}
            </div>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Free plan · No card · Meta’s message charges are billed by Meta</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Footer ---------------- */
export function Footer({ legalName, address, supportEmail }: { legalName: string; address: string | null; supportEmail: string | null }) {
  const cols: [string, [string, string][]][] = [
    ['Product', [['#how', 'How it works'], ['#flows', 'Flows'], ['#cost', 'Cost'], ['#safety', 'Number safety'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']]],
    ['Account', [['/login', 'Log in'], ['/signup', 'Create account']]],
    ['Legal', [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/acceptable-use', 'Acceptable use'], ['/messaging-policy', 'Messaging and opt-in'], ['/refunds', 'Refunds'], ['/data-deletion', 'Data deletion']]],
  ];
  return (
    <footer className="border-t border-slate-900/[0.06] dark:border-white/[0.07] bg-white/60 dark:bg-white/[0.015] pb-28 md:pb-10 pt-12">
      <div className={`${CONTAINER} grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-8`}>
        <div className="col-span-2 md:col-span-1">
          <Link href="/" className="inline-flex items-center gap-2.5 group" aria-label="LeadBotCloud home"><Logo size="sm" /></Link>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">WhatsApp lead capture, follow-up and campaigns for Indian businesses, on the official WhatsApp Business Platform.</p>
          {supportEmail ? <a href={`mailto:${supportEmail}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-700 dark:text-emerald-400">{supportEmail}</a> : null}
        </div>
        {cols.map(([h, links]) => (
          <div key={h}>
            <p className="mb-2 text-sm font-bold text-slate-900 dark:text-white">{h}</p>
            <ul>{links.map(([href, l]) => (
              <li key={href}>{href.startsWith('#') ? <a href={href} className="flex min-h-10 items-center text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">{l}</a> : <Link href={href} className="flex min-h-10 items-center text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">{l}</Link>}</li>
            ))}</ul>
          </div>
        ))}
      </div>
      <div className={`${CONTAINER} mt-10`}>
        <div className="pt-6 border-t border-slate-900/[0.06] dark:border-white/[0.07] flex flex-col md:flex-row md:items-start md:justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <p>© {new Date().getFullYear()} LeadBotCloud, a product of {legalName}.{address ? ` ${address}` : ''}</p>
          <p className="max-w-lg md:text-right">WhatsApp is a trademark of Meta Platforms, Inc. LeadBotCloud is not affiliated with or endorsed by Meta. Names and figures in the demos are samples.</p>
        </div>
      </div>
    </footer>
  );
}

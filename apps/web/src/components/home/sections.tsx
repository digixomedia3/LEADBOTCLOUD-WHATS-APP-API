import Link from 'next/link';
import { Arrow, Band, BTN_PRIMARY, CONTAINER, Check, Icon, TONE, type Tone } from './kit';
import { Logo } from './site-header';

/* ---------------- Proof strip: typographic and monochrome, so it reads as a calm separator under the hero ---------------- */
const SOURCES: [string, string][] = [
  ['bolt', 'WhatsApp ads'], ['form', 'Meta Lead Ads'], ['cart', 'Shopify'], ['sheet', 'Google Sheets'], ['store', 'IndiaMART'],
  ['store', 'JustDial'], ['globe', 'Website button'], ['qr', 'QR forms'], ['upload', 'CSV / Excel'], ['hook', 'Webhooks'],
];
const TRUST: { icon: string; t: string; d: string }[] = [
  { icon: 'shield', t: 'Official WhatsApp Business Platform', d: 'Connected through Meta’s own signup' },
  { icon: 'phone', t: 'Your number, your account', d: 'Chats and history stay yours' },
  { icon: 'rupee', t: 'Zero markup on Meta fees', d: 'Meta bills you; we charge a flat plan' },
  { icon: 'clock', t: 'Free to try today', d: 'Live sending opens with Meta’s approval' },
];

export function ProofBar() {
  return (
    <Band tone="paper" className="py-10 sm:py-12">
      <div className={CONTAINER}>
        <div data-net="proof" className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-center">
          <p className="lg:col-span-3 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Leads arrive from</p>
          <ul className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-6 gap-y-4">
            {SOURCES.map(([ic, l]) => (
              <li key={l} className="flex items-center gap-2.5 text-[14px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                <Icon name={ic} className="w-[18px] h-[18px] text-slate-400 dark:text-slate-500" />{l}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-9 pt-8 border-t border-slate-900/[0.07] dark:border-white/[0.07] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TRUST.map((x) => (
            <div key={x.t} className="flex gap-3">
              <Icon name={x.icon} className="w-5 h-5 mt-px shrink-0 text-slate-900 dark:text-white" />
              <div className="min-w-0">
                <div className="text-[14.5px] font-semibold leading-snug text-slate-900 dark:text-white">{x.t}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-slate-500 dark:text-slate-400">{x.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Band>
  );
}

/* ---------------- FAQ ---------------- */
export function Faq({ faqs, waHref }: { faqs: [string, string][]; waHref: string | null }) {
  return (
    <Band tone="paper" id="faq" labelledBy="faq-title" className="py-16 sm:py-24">
      <div className={`${CONTAINER} grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14`}>
        <div data-net="faq-aside" className="lg:col-span-4 lg:sticky lg:top-24 self-start">
          <div className="sr-in">
            <span className="inline-flex items-center gap-2 pl-1.5 pr-3.5 py-1 rounded-full bg-white dark:bg-slate-900/90 border border-slate-900/[0.08] dark:border-white/[0.1] shadow-xs">
              <span className={`min-w-6 h-6 px-1.5 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums ${TONE.indigo.soft}`}>07</span>
              <span className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200">Questions</span>
            </span>
            <h2 id="faq-title" className="mt-4 font-jk font-extrabold text-[1.95rem] sm:text-[2.4rem] lg:text-[2.65rem] leading-[1.08] tracking-[-0.035em] text-[#0F172A] dark:text-white">
              Questions, <span className="bg-linear-to-r/srgb from-[#059669] via-[#10B981] to-[#0D9488] dark:from-emerald-400 dark:via-emerald-300 dark:to-teal-300 bg-clip-text text-transparent">answered.</span>
            </h2>
          </div>
          <div className="sr-in mt-6 lg:mt-8 rounded-2xl p-5 bg-slate-50 dark:bg-white/[0.03] border border-slate-900/[0.07] dark:border-white/[0.07]">
            <div className="text-[15px] font-bold text-slate-900 dark:text-white">Talk to a person</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-slate-500 dark:text-slate-400">Not sure it fits your business? Ask us on WhatsApp. A person from our team replies.</p>
            {waHref ? (
              <a href={waHref} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center justify-center gap-2 w-full min-h-11 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white dark:text-slate-950 text-sm font-semibold hover:bg-slate-800 dark:hover:bg-emerald-400 transition-colors">
                <Icon name="chat" className="w-4 h-4" />Chat on WhatsApp
              </a>
            ) : null}
          </div>
        </div>
        <div data-net="faq-list" className="lg:col-span-8 divide-y divide-slate-900/[0.07] dark:divide-white/[0.07] border-y border-slate-900/[0.07] dark:border-white/[0.07]">
          {faqs.map(([q, a]) => (
            <details key={q} className="group">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15.5px] sm:text-[16px] font-semibold text-slate-900 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                {q}
                <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center border border-slate-900/[0.1] dark:border-white/[0.12] text-slate-500 dark:text-slate-300 transition-all duration-300 group-open:rotate-45 group-open:bg-emerald-500 group-open:border-emerald-500 group-open:text-white" aria-hidden="true">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </summary>
              <p className="pb-5 pr-2 sm:pr-12 -mt-1 text-[15px] leading-[1.7] text-slate-600 dark:text-slate-400">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Band>
  );
}

/* ---------------- Closing band: final CTA + footer on one night band ---------------- */
export function Closing({ ctaHref, ctaLabel, waHref, legalName, address, supportEmail }: { ctaHref: string; ctaLabel: string; waHref: string | null; legalName: string; address: string | null; supportEmail: string | null }) {
  const pills: [Tone, string][] = [['amber', 'Capture'], ['indigo', 'Qualify'], ['emerald', 'Convert']];
  const cols: [string, [string, string][]][] = [
    ['Product', [['#how', 'How it works'], ['#flows', 'Flows'], ['#cost', 'Cost'], ['#safety', 'Number safety'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']]],
    ['Account', [['/login', 'Log in'], ['/signup', 'Create account']]],
    ['Legal', [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/acceptable-use', 'Acceptable use'], ['/messaging-policy', 'Messaging and opt-in'], ['/refunds', 'Refunds'], ['/data-deletion', 'Data deletion']]],
  ];
  return (
    <Band tone="night" id="final-cta" labelledBy="final-title">
      <div className={`${CONTAINER} pt-20 sm:pt-28 pb-16 sm:pb-20 text-center`}>
        <div className="sr-in flex items-center justify-center gap-1.5 sm:gap-2">
          {pills.map(([t, l], i) => (
            <div key={l} className="flex items-center gap-1.5 sm:gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] sm:text-xs font-semibold ring-1 ${TONE[t].ring} ${TONE[t].soft}`}><Check className="w-3 h-3" />{l}</span>
              {i < 2 ? <span className="w-5 sm:w-8 h-px bg-white/20" aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
        <h2 id="final-title" className="sr-in mt-7 font-jk font-extrabold text-[2.2rem] sm:text-[3.2rem] lg:text-[3.8rem] leading-[1.04] tracking-[-0.04em] text-white text-balance max-w-4xl mx-auto">
          Your next sale is already <span className="bg-linear-to-r/srgb from-emerald-400 via-emerald-300 to-teal-300 bg-clip-text text-transparent">in your chats.</span>
        </h2>
        <p className="sr-in mt-5 text-[1.05rem] sm:text-[1.15rem] leading-[1.65] text-slate-400 max-w-xl mx-auto">
          Make a free workspace in a minute. Bring in your leads, pick a flow, and see the cost before you spend a rupee.
        </p>
        <div data-net="cta" className="sr-in mt-9 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-3.5 max-w-md sm:max-w-none sm:w-fit mx-auto">
          <Link href={ctaHref} className={`${BTN_PRIMARY} sm:px-8 sm:py-4 sm:text-base`}>{ctaLabel}<Arrow /></Link>
          {waHref ? (
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 sm:py-4 rounded-xl border border-white/15 bg-white/[0.04] text-white font-semibold text-[15px] sm:text-base hover:bg-white/[0.08] hover:border-white/25 transition-colors">
              <Icon name="chat" className="w-4 h-4 text-emerald-400" />Talk to us on WhatsApp
            </a>
          ) : null}
        </div>
        <p className="sr-in mt-5 text-[13px] text-slate-500">Free plan · No card needed · Meta’s message charges are billed by Meta</p>
      </div>

      <footer className={`${CONTAINER} pb-28 md:pb-12`}>
        <div className="pt-12 border-t border-white/[0.08] grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr] gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2.5 group" aria-label="LeadBotCloud home"><Logo size="sm" /></Link>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">WhatsApp lead capture, follow-up and campaigns for Indian businesses, on the official WhatsApp Business Platform.</p>
            {supportEmail ? <a href={`mailto:${supportEmail}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-400 hover:text-emerald-300">{supportEmail}</a> : null}
          </div>
          {cols.map(([h, links]) => (
            <div key={h}>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-slate-500">{h}</p>
              <ul>{links.map(([href, l]) => (
                <li key={href}>{href.startsWith('#') ? <a href={href} className="flex min-h-10 items-center text-sm text-slate-300 hover:text-white">{l}</a> : <Link href={href} className="flex min-h-10 items-center text-sm text-slate-300 hover:text-white">{l}</Link>}</li>
              ))}</ul>
            </div>
          ))}
        </div>
        <div className="mt-10 pt-6 border-t border-white/[0.08] flex flex-col md:flex-row md:items-start md:justify-between gap-3 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} LeadBotCloud, a product of {legalName}.{address ? ` ${address}` : ''}</p>
          <p className="max-w-lg md:text-right">WhatsApp is a trademark of Meta Platforms, Inc. LeadBotCloud is not affiliated with or endorsed by Meta. Names and figures in the demos are samples.</p>
        </div>
      </footer>
    </Band>
  );
}


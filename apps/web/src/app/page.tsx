import type { Metadata } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Ban, Check, CheckCircle2, IndianRupee, Lock, MessageSquareWarning, UserCheck, X } from 'lucide-react';
import { PLAN_LIMITS } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { ScrollReveal } from '@/components/marketing/scroll-reveal';
import { Doodle } from '@/components/marketing/doodle';
import { HeroPhone } from '@/components/marketing/hero-phone';
import { WakeStage } from '@/components/marketing/wake-stage';
import { HowTabs } from '@/components/marketing/how-tabs';
import { BusinessPicker } from '@/components/marketing/business-picker';
import { MobileMenu, StickyCta } from '@/components/marketing/site-chrome';
import { estimateCost } from '@/lib/cost';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap' });

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your contact list is your next sale. Wake it up on WhatsApp.',
  description: 'LeadBotCloud turns the contact list you already have into sales and renewals on WhatsApp. See the cost before you send. Skip people who opted out. Protect your number.',
  openGraph: { type: 'website', siteName: 'LeadBotCloud', title: 'Your contact list is your next sale. Wake it up.', description: 'Message the customers who already know you, on WhatsApp. Cost shown first. Opt-outs skipped for you.' },
  twitter: { card: 'summary_large_image' },
};

const NAV: [string, string][] = [['#wake', 'Try it'], ['#how', 'How it works'], ['#send', 'What to send'], ['#safety', 'Safety'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']];

const faqs: [string, string][] = [
  ['Can I really message my whole list?', 'You can upload every contact. Messages go only to people with a permission on record: you tell us where each person agreed, and we keep that record. People without one are skipped and counted, so you always see who was left out and why.'],
  ['Is this the official WhatsApp Business Platform?', 'Yes. You connect your own WhatsApp Business account through Meta’s Embedded Signup. Your number, your account and your message history stay yours. Right now the connection step is being switched on, and the panel runs in a clearly marked test mode until then.'],
  ['What will I pay in total?', 'Our plan fee, plus GST, plus Meta’s own message charges, which Meta bills to your card. We add no markup on messages. The calculator uses ₹0.8631 per promotional message and ₹0.115 per update, before 18% GST, from the July 2026 India rate card. Meta changes rates, so the live cost preview before every send is what counts.'],
  ['Why would some of my messages not arrive?', 'Meta limits how many promotional messages one person can receive from all businesses combined. Messages Meta blocks for this reason are not charged. We show them in your report instead of hiding them, so you can follow up another way.'],
  ['What stops my number from being restricted?', 'Opted-out people are never messaged. We check your daily limit and quality rating before a send, warn you when a template is likely to be rejected, and show the cost before you commit. We cannot promise Meta will never act on an account. Sending messages people welcome is what keeps a number healthy.'],
  ['Which businesses cannot use LeadBotCloud?', 'Crypto and trading, gambling, adult content and anything else WhatsApp’s Commerce Policy bans. Loans, insurance, healthcare and a few others go through a short review. We would rather say no at signup than see your number banned later.'],
  ['What is the difference from the free WhatsApp Business app?', 'The app is for chatting. Its broadcast lists are capped, and only reach people who saved your number. The API route sends approved templates to everyone who agreed, with a shared inbox for your team. It also has rules: approved templates, permission, and per-message charges.'],
  ['Is my customer data safe from other businesses on the platform?', 'Each workspace is separated inside the database itself, not only in our code. We test that one business cannot read another’s contacts, chats or campaigns. Every export and delete is written to an audit log.'],
  ['Do I have to sign a contract?', 'No. Plans are monthly. Online payment is being switched on, so today you can try everything on the free plan without a card.'],
  ['Who sets it up?', 'You can do it yourself: upload a file, choose a template, send. Connecting your WhatsApp number is a guided checklist inside Settings.'],
];

const plans = [
  { id: 'free', price: '₹0', note: 'Try it properly', pts: ['Shared inbox', 'Templates and the checker', '2 campaigns a month', 'Auto-replies (3 rules)'] },
  { id: 'starter', price: '₹499', note: 'One shop or team', pts: ['Unlimited campaigns', 'Auto-replies', 'Ready-made templates'] },
  { id: 'growth', price: '₹1,299', note: 'Teams that renew and follow up', hot: true, pts: ['Renewal reminders', 'Number health centre', 'Everything in Starter'] },
  { id: 'pro', price: '₹2,999', note: 'Bigger teams', pts: ['3 WhatsApp numbers', 'API access and webhooks', 'Priority support'] },
] as const;

const funnel = (() => {
  const afterStop = 2064;
  return [
    { Icon: UserCheck, big: '2,100', unit: 'of 3,000', t: 'Permission on record', d: '900 people never agreed, so they are skipped and listed in your report.' },
    { Icon: Ban, big: '2,064', unit: 'left', t: 'STOP is honoured', d: '36 replied STOP before. They are logged with the date and never messaged again.' },
    { Icon: MessageSquareWarning, big: 'Template OK', unit: '', t: 'Rejection pre-check', d: 'Warns about what gets templates rejected: variables at the start, missing samples, banned wording.' },
    { Icon: IndianRupee, big: estimateCost(afterStop, 'marketing').totalLabel.replace('.00', ''), unit: 'with GST', t: 'Cost and spend cap', d: 'Shown first. If the estimate is over your cap, nothing is sent.' },
  ] as const;
})();

const compare: [string, string, string][] = [
  ['Who receives it', 'Only people who saved your number', 'Everyone with a permission on record'],
  ['List size', 'Broadcast lists stop at 256', 'Your whole list, up to your plan’s contact limit'],
  ['Your team', 'One phone and a few linked devices', 'Shared inbox with assignment and notes'],
  ['Opted-out people', 'You have to remember to skip them', 'Skipped automatically and logged'],
  ['Risk to your number', 'Campaigning from it can get it flagged', 'Checks and limits built to protect it'],
];

function H2({ children, className }: { children: React.ReactNode; className?: string }) { return <h2 className={cn('font-display text-balance text-[2rem] font-extrabold leading-[1.05] sm:text-5xl lg:text-[3.4rem]', className)}>{children}</h2>; }

export default async function Landing() {
  const session = await getSession();
  const cta = session ? { href: '/dashboard', label: 'Open your dashboard' } : { href: '/signup', label: 'Start free' };
  return (
    <div className={cn('lp min-h-dvh overflow-x-clip', display.variable)}>
      <ScrollReveal />
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="relative mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-display text-xl font-extrabold"><span className="flex size-9 items-center justify-center rounded-xl bg-[var(--lp-wa)] text-[#04221a]">L</span>LeadBotCloud</Link>
          <nav className="ml-6 hidden items-center gap-1 text-sm font-semibold text-muted lg:flex" aria-label="Sections">
            {NAV.map(([h, l]) => <a key={h} href={h} className="rounded-lg px-3 py-2 hover:bg-ink/5 hover:text-ink">{l}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle className="hidden sm:inline-flex" />
            {!session ? <Link href="/login" className="hidden min-h-11 items-center px-3 text-sm font-semibold sm:flex">Log in</Link> : null}
            <Link href={cta.href} className="lp-wa-btn inline-flex min-h-10 items-center whitespace-nowrap rounded-xl px-3.5 text-sm font-bold">{cta.label}</Link>
            <MobileMenu items={NAV} loginHref={session ? undefined : '/login'} />
          </div>
        </div>
      </header>

      {/* 1. HERO: one idea, proven in the first screen. You play the customer. */}
      <section className="lp-drench">
        <Doodle id="lp-doodle-hero" />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-8 sm:pb-24 sm:pt-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-20">
          <div className="reveal min-w-0">
            <h1 className="font-display text-[2.5rem] font-extrabold leading-[0.98] sm:text-7xl">Your contact list is your next sale. <span className="text-[var(--lp-wa)]">Wake it up.</span></h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/80 sm:mt-6 sm:text-xl">Send offers and reminders on WhatsApp to everyone who agreed to hear from you.<span className="hidden sm:inline"> You see the cost first, and opted-out people are skipped for you.</span></p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-8 sm:gap-3">
              <Link href={cta.href} className="lp-wa-btn inline-flex min-h-14 items-center gap-2 rounded-xl px-8 text-lg font-bold">{cta.label}<ArrowRight className="size-5" /></Link>
              <a href="#wake" className="inline-flex min-h-12 items-center gap-2 rounded-xl text-base font-semibold underline decoration-white/40 underline-offset-4 transition hover:bg-white/10 sm:min-h-14 sm:border sm:border-white/30 sm:px-6 sm:no-underline">See your list wake up<ArrowDown className="size-4" /></a>
            </div>
            <ul className="mt-5 hidden flex-wrap gap-x-6 gap-y-2 text-sm text-white/80 sm:mt-6 sm:flex">{['Free plan, no card', 'No markup on messages', 'Opt-outs always respected'].map((t) => <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-[var(--lp-wa)]" />{t}</li>)}</ul>
            <p className="mt-4 hidden max-w-md text-xs text-white/55 sm:block">Sending to real customers switches on once your WhatsApp number is connected. Until then the whole panel runs in a clearly marked test mode.</p>
          </div>
          <div className="reveal min-w-0 [animation-delay:0.15s] lg:pl-12 lg:pr-10"><HeroPhone /><p className="mx-auto mt-5 max-w-xs text-center text-sm text-white/75 sm:hidden">Free plan, no card · No markup on messages · Opt-outs always respected</p></div>
        </div>
      </section>

      {/* 2. THE STAGE: the visitor's own list, waking up. */}
      <section id="wake" className="lp-paper scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="sr max-w-3xl">
            <H2>Press send. See what wakes up.</H2>
            <p className="mt-4 text-lg text-muted">Most lists sit untouched, because the free app caps broadcasts at 256 and only reaches people who saved your number. Enter your numbers and watch what one message to everyone who agreed could do.</p>
          </div>
          <div className="sr mt-10"><WakeStage ctaHref={cta.href} ctaLabel={cta.label} /></div>
        </div>
      </section>

      {/* 3. HOW: four tabs, each a real screen. */}
      <section id="how" className="scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="sr max-w-3xl"><H2>From a silent list to a busy inbox.</H2><p className="mt-4 text-lg text-muted">Four steps, one panel. Tap through them.</p></div>
          <div className="sr mt-10"><HowTabs /></div>
          <p className="mt-6 text-sm text-muted">The panel is built and runs in test mode until your WhatsApp number is connected.</p>
        </div>
      </section>

      {/* 4. WHAT TO SEND: pick your business. */}
      <section id="send" className="lp-paper-2 scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="sr max-w-3xl"><H2>Pick your business. See what to send.</H2></div>
          <div className="sr mt-10"><BusinessPicker ctaHref={cta.href} ctaLabel={cta.label} /></div>
        </div>
      </section>

      {/* 5. SAFETY: a pipe your list flows through before anything is sent. */}
      <section id="safety" className="lp-drench lp-drench-deep scroll-mt-16">
        <Doodle id="lp-doodle-safety" className="text-white/[0.035]" />
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <div className="sr max-w-3xl"><H2>Nothing leaves until four checks pass.</H2><p className="mt-4 text-lg text-white/75">Most panels let you send first and find out later. Here your list passes through each check, and you see what it did to the numbers before you press send.</p></div>
          <div className="lp-pipe sr mt-14">
            <span aria-hidden="true" className="absolute bottom-0 left-[1.35rem] top-0 w-px bg-white/20 lg:bottom-auto lg:left-0 lg:right-0 lg:top-[1.35rem] lg:h-px lg:w-auto" />
            <span aria-hidden="true" className="lp-packet" />
            <ol className="grid gap-8 lg:grid-cols-4 lg:gap-6">
              {funnel.map(({ Icon, big, unit, t, d }, i) => (
                <li key={t} className="relative pl-16 lg:pl-0 lg:pt-16">
                  <span className="absolute left-0 top-0 flex size-11 items-center justify-center rounded-full bg-[var(--lp-g8)] text-[var(--lp-wa)] ring-1 ring-white/25"><Icon className="size-5" /></span>
                  <p className="font-display text-3xl font-extrabold tabular-nums">{big} <span className="text-sm font-semibold text-white/60">{unit}</span></p>
                  <h3 className="mt-1 text-base font-bold">{i + 1}. {t}</h3>
                  <p className="mt-1.5 text-sm text-white/70">{d}</p>
                </li>
              ))}
            </ol>
          </div>
          <p className="sr mt-6 text-xs text-white/50">Sample numbers for illustration.</p>
          <div className="sr mt-12 grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/15 bg-white/5 p-6">
              <h3 className="flex items-center gap-2 font-display text-xl font-bold"><Lock className="size-5 text-[var(--lp-wa)]" />Always on: your data stays yours</h3>
              <p className="mt-2 text-sm text-white/75">Each business is separated inside the database itself, and we test that one business can never read another’s contacts, chats or campaigns. Every export and deletion is written to an audit log.</p>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/5 p-6">
              <h3 className="font-display text-xl font-bold">What we do not promise</h3>
              <ul className="mt-3 space-y-2 text-sm text-white/80">{['We cannot guarantee Meta will never restrict an account. We reduce the risk and tell you early.', 'We cannot make Meta deliver every message. Messages it blocks are not charged.', 'Approval of a template is Meta’s decision, not ours.'].map((x) => <li key={x} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-[var(--lp-gold)]" />{x}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      {/* 6. WHY NOT THE FREE APP */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-4">
          <div className="sr max-w-3xl"><H2>Why not just use the free WhatsApp Business app?</H2><p className="mt-4 text-lg text-muted">The app is for chatting. This is for reaching your whole list.</p></div>
          <div className="sr mt-10 overflow-hidden rounded-3xl border border-line bg-card">
            <div className="hidden grid-cols-[0.8fr_1fr_1.2fr] border-b border-line text-sm font-bold md:grid"><span className="px-5 py-4" /><span className="px-5 py-4 text-muted">WhatsApp Business app</span><span className="bg-[var(--lp-g8)] px-5 py-4 text-white">LeadBotCloud</span></div>
            {compare.map(([a, b, c]) => (
              <div key={a} className="grid border-b border-line last:border-0 md:grid-cols-[0.8fr_1fr_1.2fr]">
                <p className="px-5 pt-4 font-display text-lg font-bold md:py-4">{a}</p>
                <p className="flex items-start gap-2 px-5 py-2 text-muted md:py-4"><X className="mt-1 size-4 shrink-0 text-rose" /><span><span className="font-semibold md:hidden">App: </span>{b}</span></p>
                <p className="flex items-start gap-2 bg-brand/[0.07] px-5 py-2 pb-4 font-medium md:py-4"><Check className="mt-1 size-4 shrink-0 lp-gtext" /><span><span className="font-semibold md:hidden">LeadBotCloud: </span>{c}</span></p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">The API route has rules of its own: approved templates, recorded permission, and per-message charges from Meta.</p>
        </div>
      </section>

      {/* 7. PRICING */}
      <section id="pricing" className="lp-paper scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="sr text-center"><H2>Simple monthly plans.</H2><p className="mx-auto mt-3 max-w-xl text-muted">Plan prices exclude GST. WhatsApp message charges are paid to Meta separately, at Meta’s rate, with no markup from us.</p></div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p, i) => { const l = PLAN_LIMITS[p.id]; const hot = 'hot' in p; return (
              <div key={p.id} style={{ ['--i' as string]: i }} className={cn('sr sr-zoom card relative flex flex-col p-6', hot && 'border-[var(--lp-g8)] ring-2 ring-[var(--lp-wa)] lg:-mt-4 lg:pb-10')}>
                {hot ? <span className="absolute -top-3 left-6 rounded-full bg-[var(--lp-wa)] px-3 py-1 text-xs font-bold text-[#04221a]">Most popular</span> : null}
                <h3 className="font-display text-xl font-bold">{l.label}</h3><p className="text-xs text-muted">{p.note}</p>
                <p className="mt-4 font-display text-4xl font-extrabold">{p.price}<span className="text-sm font-medium text-muted">/month</span></p>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm"><li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 lp-gtext" />{l.users} {l.users === 1 ? 'user' : 'users'}, {l.contacts.toLocaleString('en-IN')} contacts</li>{p.pts.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 lp-gtext" />{x}</li>)}</ul>
                {hot ? <Link href={cta.href} className="lp-wa-btn mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl text-base font-bold">{cta.label}</Link> : <Button asChild variant="outline" className="mt-6 w-full"><Link href={cta.href}>{cta.label}</Link></Button>}
              </div>); })}
          </div>
          <p className="mt-6 text-center text-xs text-muted">Online payment is being switched on. Until then every account starts on the free plan and carries over when paid plans open. You are never charged without a card on file.</p>
        </div>
      </section>

      {/* 8. FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-16 px-4 py-20 sm:py-28">
        <div className="sr mb-10 text-center"><H2>Before you sign up.</H2></div>
        <div className="space-y-3">{faqs.map(([q, a]) => (
          <details key={q} className="card group p-0"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-semibold">{q}<span className="text-2xl leading-none text-[var(--lp-g7)] transition-transform group-open:rotate-45 dark:text-brand" aria-hidden="true">+</span></summary><p className="px-5 pb-5 text-sm text-muted">{a}</p></details>))}</div>
      </section>

      {/* 9. CLOSE */}
      <section id="final-cta" className="lp-drench">
        <Doodle id="lp-doodle-final" />
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
          <H2>They already know you. Say something.</H2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/80">Make a free workspace in a minute. Upload a list, see the cost, and try the whole panel before you spend a rupee.</p>
          <Link href={cta.href} className="lp-wa-btn mt-8 inline-flex min-h-14 items-center gap-2 rounded-xl px-9 text-lg font-bold">{cta.label}<ArrowRight className="size-5" /></Link>
          <p className="mt-4 text-xs text-white/60">Free plan, no card. Message charges are set by Meta and billed separately.</p>
        </div>
      </section>

      <footer className="border-t border-line px-4 pb-24 pt-10 text-sm text-muted lg:pb-10">
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div><p className="flex items-center gap-2 font-display text-lg font-extrabold text-ink"><span className="flex size-8 items-center justify-center rounded-lg bg-[var(--lp-wa)] text-[#04221a]">L</span>LeadBotCloud</p><p className="mt-3 max-w-sm">WhatsApp marketing for Indian businesses. A product of DigiXoMedia.</p></div>
          <div><p className="mb-2 font-semibold text-ink">Product</p><ul>{[['#how', 'How it works'], ['#safety', 'Safety'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']].map(([h, l]) => <li key={h}><a href={h} className="flex min-h-11 items-center hover:text-ink">{l}</a></li>)}</ul></div>
          <div><p className="mb-2 font-semibold text-ink">Account</p><ul><li><Link href="/login" className="flex min-h-11 items-center hover:text-ink">Log in</Link></li><li><Link href="/signup" className="flex min-h-11 items-center hover:text-ink">Create account</Link></li></ul></div>
          <div><p className="mb-2 font-semibold text-ink">Legal</p><ul>{([['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/acceptable-use', 'Acceptable use'], ['/messaging-policy', 'Messaging and opt-in'], ['/refunds', 'Refunds'], ['/data-deletion', 'Data deletion']] as const).map(([h, l]) => <li key={h}><Link href={h} className="flex min-h-11 items-center hover:text-ink">{l}</Link></li>)}</ul></div>
        </div>
        <div className="mx-auto mt-8 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs">
          <p>© {new Date().getFullYear()} LeadBotCloud, a product of DigiXoMedia.</p>
          <p className="max-w-lg">WhatsApp is a trademark of Meta Platforms, Inc. LeadBotCloud is not affiliated with or endorsed by Meta. Photos are illustrative stock images from Pexels.</p>
        </div>
      </footer>
      <StickyCta href={cta.href} label={session ? cta.label : 'Start free: takes 1 minute'} />
    </div>
  );
}

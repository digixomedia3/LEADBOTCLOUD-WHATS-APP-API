import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BellRing, CheckCircle2, FileText, IndianRupee, Megaphone, MessageSquare, ShieldCheck, Upload, Users } from 'lucide-react';
import { PLAN_LIMITS } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { CostCalculator } from '@/components/marketing/cost-calculator';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'WhatsApp marketing for Indian businesses',
  description: 'Send WhatsApp campaigns, manage contacts and chat with customers. See the cost, daily limit and opt-outs before every send.',
};

const features = [
  { Icon: IndianRupee, t: 'See the cost first', d: 'Every campaign shows messages × rate + GST before you press send. No billing surprises.' },
  { Icon: ShieldCheck, t: 'Protect your number', d: 'We check your daily limit, quality rating and opt-outs so a campaign cannot get your number restricted.' },
  { Icon: Upload, t: 'Import in a minute', d: 'Drop an Excel-saved CSV. Hindi or English columns, messy numbers and repeats are cleaned for you.' },
  { Icon: FileText, t: 'Approved templates', d: 'Write official WhatsApp templates with a pre-check that warns before Meta rejects them.' },
  { Icon: MessageSquare, t: 'One shared inbox', d: 'Your team answers every customer from one place, with assignment and quick replies.' },
  { Icon: BellRing, t: 'Renewal reminders', d: 'Remind customers before a plan expires, with a payment link. Built for subscriptions, gyms, schools and ISPs.' },
];

const plans = [
  { id: 'free', price: '₹0', note: 'Try it properly', pts: ['1 WhatsApp number', 'Shared inbox', '2 bulk sends a month', 'Auto-replies (3 rules)'] },
  { id: 'starter', price: '₹499', note: 'For one shop or team', pts: ['1 WhatsApp number', 'Unlimited bulk sends', 'Auto-replies', 'Ready-made templates'] },
  { id: 'growth', price: '₹1,299', note: 'Most popular', hot: true, pts: ['Renewal reminders', 'AI message writer', 'Google Sheets sync', 'Number health centre'] },
  { id: 'pro', price: '₹2,999', note: 'For bigger teams', pts: ['3 WhatsApp numbers', 'API access and webhooks', 'Chatbot flows', 'Priority support'] },
] as const;

const faqs = [
  ['Do I need a WhatsApp Business API account?', 'No. You connect your number through Meta’s official Embedded Signup inside the panel. We guide each step.'],
  ['Who pays Meta for the messages?', 'You do, directly to Meta on your own card, at Meta’s own rate. We add no markup on messages. Our plan fee is separate.'],
  ['Can I message anyone?', 'Only people who agreed to hear from you. The panel records where each customer opted in, and stops messaging anyone who replies STOP.'],
  ['Which businesses are not allowed?', 'Crypto and trading, gambling, adult content and anything Meta’s Commerce Policy bans. Loans, insurance and healthcare go through a short review.'],
  ['Is my customers’ data separate from other businesses?', 'Yes. Every workspace is isolated at the database level, so one business can never read another’s contacts or chats.'],
  ['Why do some messages not deliver?', 'Meta limits how many marketing messages one person can get from all businesses. We show affected messages clearly so you can follow up another way.'],
];

export default async function Landing() {
  const session = await getSession();
  const cta = session ? { href: '/dashboard', label: 'Open dashboard' } : { href: '/signup', label: 'Start free' };
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-extrabold"><span className="grad-bg flex size-9 items-center justify-center rounded-xl text-white">L</span>LeadBotCloud</Link>
          <nav className="ml-6 hidden items-center gap-1 text-sm font-semibold text-muted md:flex" aria-label="Sections">
            {[['#features', 'Features'], ['#cost', 'Cost'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']].map(([h, l]) => <a key={h} href={h} className="rounded-lg px-3 py-2 hover:bg-ink/5 hover:text-ink">{l}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {!session ? <Link href="/login" className="hidden min-h-11 items-center px-3 text-sm font-semibold sm:flex">Log in</Link> : null}
            <Button asChild size="sm"><Link href={cta.href}>{cta.label}</Link></Button>
          </div>
        </div>
      </header>

      <section className="aurora">
        <div className="blob" />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="reveal">
            <p className="glass mb-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"><span className="live-dot" />Built for Indian small businesses</p>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] sm:text-6xl">WhatsApp marketing that <span className="grad-text">shows every rupee</span> before you send.</h1>
            <p className="mt-5 max-w-xl text-lg text-white/75">Campaigns, contacts and a shared inbox in one calm panel. We check the cost, your daily limit and opt-outs first, so your number stays safe.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href={cta.href}>{cta.label}<ArrowRight className="size-5" /></Link></Button>
              <a href="#cost" className="glass inline-flex min-h-12 items-center rounded-xl px-6 text-sm font-semibold">Estimate my cost</a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
              {['Free plan, no card', 'No markup on messages', 'Official Meta connection'].map((t) => <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-brand" />{t}</li>)}
            </ul>
          </div>
          {/* Product preview: a real campaign check, drawn with the same pieces as the app */}
          <div className="glass reveal rounded-3xl p-5 [animation-delay:0.15s]" aria-hidden="true">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold"><Megaphone className="size-4 text-brand" />Diwali offer · ready to send</p>
            <div className="space-y-2 text-sm">
              {[['Audience', '1,240 opted-in contacts'], ['Cost estimate', '₹1,258 incl. GST'], ['Daily limit', '1,000 left today'], ['Opted out', '14 skipped']].map(([k, v]) => <div key={k} className="flex justify-between rounded-xl bg-white/10 px-3 py-2.5"><span className="text-white/70">{k}</span><span className="font-semibold">{v}</span></div>)}
            </div>
            <p className="mt-3 rounded-xl bg-amber/20 px-3 py-2 text-xs text-amber">240 messages will wait until tomorrow to protect your number.</p>
            <div className="grad-bg mt-4 rounded-xl py-3 text-center text-sm font-bold">Send 1,000 now, schedule the rest</div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <h2 className="font-display text-3xl font-extrabold sm:text-4xl">Fixes what other panels get wrong</h2>
        <p className="mt-3 max-w-2xl text-muted">Customers leave WhatsApp panels over surprise bills, confusing failures and painful setup. We built against those.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ Icon, t, d }) => (
            <div key={t} className="card card-hover p-6"><span className="grad-bg mb-4 flex size-11 items-center justify-center rounded-xl text-white"><Icon className="size-5" /></span><h3 className="font-display text-lg font-bold">{t}</h3><p className="mt-1.5 text-sm text-muted">{d}</p></div>
          ))}
        </div>
      </section>

      <section id="cost" className="scroll-mt-20 bg-card2 px-4 py-20">
        <div className="mx-auto max-w-6xl text-center">
          <h2 className="font-display text-3xl font-extrabold sm:text-4xl">What will a campaign cost?</h2>
          <p className="mx-auto mb-10 mt-3 max-w-2xl text-muted">The same maths the panel shows you before every send.</p>
          <CostCalculator />
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <h2 className="text-center font-display text-3xl font-extrabold sm:text-4xl">Simple monthly plans</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted">Plan price excludes GST. WhatsApp message charges are paid to Meta separately.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const l = PLAN_LIMITS[p.id];
            return (
              <div key={p.id} className={`card relative flex flex-col p-6 ${'hot' in p ? 'border-brand ring-2 ring-brand/30' : ''}`}>
                {'hot' in p ? <span className="grad-bg absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-bold text-white">Most popular</span> : null}
                <h3 className="font-display text-lg font-bold">{l.label}</h3><p className="text-xs text-muted">{p.note}</p>
                <p className="mt-4 font-display text-4xl font-extrabold">{p.price}<span className="text-sm font-medium text-muted">/month</span></p>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                  <li className="flex gap-2"><Users className="mt-0.5 size-4 shrink-0 text-brand" />{l.users} {l.users === 1 ? 'user' : 'users'}, {l.contacts.toLocaleString('en-IN')} contacts</li>
                  {p.pts.map((x) => <li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />{x}</li>)}
                </ul>
                <Button asChild variant={'hot' in p ? 'primary' : 'outline'} className="mt-6 w-full"><Link href={session ? '/dashboard' : '/signup'}>{p.id === 'free' ? 'Start free' : `Choose ${l.label}`}</Link></Button>
              </div>
            );
          })}
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-20">
        <h2 className="mb-8 text-center font-display text-3xl font-extrabold sm:text-4xl">Questions</h2>
        <div className="space-y-3">
          {faqs.map(([q, a]) => (
            <details key={q} className="card group p-0"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-semibold">{q}<span className="text-xl text-brand transition-transform group-open:rotate-45" aria-hidden="true">+</span></summary><p className="px-5 pb-5 text-sm text-muted">{a}</p></details>
          ))}
        </div>
      </section>

      <section className="aurora"><div className="blob" />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h2 className="font-display text-3xl font-extrabold sm:text-4xl">Send your first campaign today</h2>
          <p className="mt-3 text-white/75">Create a free workspace in a minute. No card needed.</p>
          <Button asChild size="lg" className="mt-7"><Link href={cta.href}>{cta.label}<ArrowRight className="size-5" /></Link></Button>
        </div>
      </section>

      <footer className="border-t border-line px-4 py-8 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} LeadBotCloud, a product of DigiXoMedia.</p>
          <p className="max-w-md text-xs">WhatsApp is a trademark of Meta Platforms, Inc. LeadBotCloud is not affiliated with or endorsed by Meta.</p>
        </div>
      </footer>
    </div>
  );
}

import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Ban, CheckCircle2, ClipboardList, FileSpreadsheet, Globe, IndianRupee, Lock, Megaphone, MessageSquareWarning, ShoppingBag, Smartphone, Store, UserCheck, Users, X } from 'lucide-react';
import { PLAN_LIMITS } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { SleepingCalc } from '@/components/marketing/sleeping-calc';
import { Bubble, PhoneFrame, Reply_, Shot } from '@/components/marketing/bubbles';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Message the customers who already know you, on WhatsApp',
  description: 'LeadBotCloud turns the contact list you already have into sales and renewals on WhatsApp. See the cost before you send. Skip people who opted out. Protect your number.',
};

const sources = [
  { Icon: ShoppingBag, t: 'Order sheets and billing software', d: 'Everyone who ever paid you.' },
  { Icon: ClipboardList, t: 'Enquiry registers and forms', d: 'People who asked, then went quiet.' },
  { Icon: Megaphone, t: 'Ad and portal leads', d: 'Leads you already paid to get.' },
  { Icon: Smartphone, t: 'Walk-ins and phone contacts', d: 'Numbers saved across your team’s phones.' },
  { Icon: Globe, t: 'Website and app sign-ups', d: 'Trials, carts, demo requests.' },
  { Icon: FileSpreadsheet, t: 'Event and exhibition sheets', d: 'Every stall, seminar and camp.' },
];

const business = [
  ['online-store', 'Online stores'], ['travel', 'Travel agencies'], ['salon', 'Salons and cafes'], ['coaching', 'Coaching institutes'], ['clinic', 'Clinics and labs'], ['factory', 'Manufacturers and traders'],
  ['realestate', 'Real estate'], ['creator', 'Coaches and creators'], ['finance', 'Insurance and advisors'], ['gym', 'Gyms and fitness'], ['startup', 'Startups and software'], ['abroad', 'Study abroad'],
] as const;

const faqs: [string, string][] = [
  ['Can I really message my whole list?', 'You can upload every contact. Messages go only to people with a permission on record: you tell us where each person agreed, and we keep that record. People without one are skipped and counted, so you always see who was left out and why.'],
  ['Is this the official WhatsApp Business Platform?', 'Yes. You connect your own WhatsApp Business account through Meta’s Embedded Signup. Your number, your account and your message history stay yours. Right now the connection step is being switched on, and the panel runs in a clearly marked test mode until then.'],
  ['What will I pay in total?', 'Our plan fee, plus GST, plus Meta’s own message charges, which Meta bills to your card. We add no markup on messages. The calculator above uses ₹0.8631 per promotional message and ₹0.115 per update, before 18% GST, from the July 2026 India rate card. Meta changes rates, so the live cost preview before every send is what counts.'],
  ['Why would some of my messages not arrive?', 'Meta limits how many promotional messages one person can receive from all businesses combined. Messages Meta blocks for this reason are not charged. We show them in your report instead of hiding them, so you can follow up another way.'],
  ['What stops my number from being restricted?', 'Opted-out people are never messaged. We check your daily limit and quality rating before a send, warn you when a message format is likely to be rejected, and show the cost before you commit. We cannot promise Meta will never act on an account. Sending messages people welcome is what keeps a number healthy.'],
  ['Which businesses cannot use LeadBotCloud?', 'Crypto and trading, gambling, adult content and anything else WhatsApp’s Commerce Policy bans. Loans, insurance, healthcare and a few others go through a short review. We would rather say no at signup than see your number banned later.'],
  ['What is the difference from the free WhatsApp Business app?', 'The app is for chatting. Its broadcast lists are capped, and only reach people who saved your number. The API route sends approved message formats to everyone who agreed, with a shared inbox for your team. It also has rules: approved formats, permission, and per-message charges.'],
  ['Is my customer data safe from other businesses on the platform?', 'Each workspace is separated inside the database itself, not only in our code. We test that one business cannot read another’s contacts, chats or campaigns. Every export and delete is written to an audit log.'],
  ['Do I have to sign a contract?', 'No. Plans are monthly. Online payment is being switched on, so today you can try everything on the free plan without a card.'],
  ['Who sets it up?', 'You can do it yourself: upload a file, choose a message format, send. Connecting your WhatsApp number is a guided checklist inside Settings.'],
];

const plans = [
  { id: 'free', price: '₹0', note: 'Try it properly', pts: ['Shared inbox', 'Message formats and the checker', '2 bulk sends a month', 'Auto-replies (3 rules)'] },
  { id: 'starter', price: '₹499', note: 'One shop or team', pts: ['Unlimited bulk sends', 'Auto-replies', 'Ready-made message formats'] },
  { id: 'growth', price: '₹1,299', note: 'Most popular', hot: true, pts: ['Renewal reminders', 'Number health centre', 'Everything in Starter'] },
  { id: 'pro', price: '₹2,999', note: 'Bigger teams', pts: ['3 WhatsApp numbers', 'API access and webhooks', 'Priority support'] },
] as const;

function Eyebrow({ children }: { children: React.ReactNode }) { return <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-brand">{children}</p>; }
function H2({ children, className }: { children: React.ReactNode; className?: string }) { return <h2 className={cn('font-display text-3xl font-extrabold leading-tight sm:text-5xl', className)}>{children}</h2>; }

export default async function Landing() {
  const session = await getSession();
  const cta = session ? { href: '/dashboard', label: 'Open your dashboard' } : { href: '/signup', label: 'Start free' };
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-display text-lg font-extrabold"><span className="grad-bg flex size-9 items-center justify-center rounded-xl text-white">L</span>LeadBotCloud</Link>
          <nav className="ml-6 hidden items-center gap-1 text-sm font-semibold text-muted lg:flex" aria-label="Sections">
            {[['#list', 'Your list'], ['#how', 'How it works'], ['#messages', 'What to send'], ['#safety', 'Safety'], ['#cost', 'Cost'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']].map(([h, l]) => <a key={h} href={h} className="rounded-lg px-3 py-2 hover:bg-ink/5 hover:text-ink">{l}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {!session ? <Link href="/login" className="hidden min-h-11 items-center px-3 text-sm font-semibold sm:flex">Log in</Link> : null}
            <Button asChild size="sm"><Link href={cta.href}>{cta.label}</Link></Button>
          </div>
        </div>
      </header>

      {/* 1. HERO: Decide. One idea: your list is asleep. */}
      <section className="aurora">
        <div className="blob" /><div className="aurora-grid" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="reveal min-w-0">
            <p className="glass mb-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"><span className="live-dot size-2 rounded-full bg-brand" />Built in India, for Indian businesses</p>
            <h1 className="font-display text-4xl font-extrabold leading-[1.04] sm:text-6xl">Your contact list is your next sale. <span className="grad-text">Wake it up.</span></h1>
            <p className="mt-5 max-w-xl text-lg text-white/75">Past buyers, old enquiries, ad leads, walk-ins. They already know you. Message everyone who agreed to hear from you on WhatsApp, with the cost shown first and opted-out people skipped for you.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href={cta.href}>{cta.label}<ArrowRight className="size-5" /></Link></Button>
              <a href="#cost" className="glass inline-flex min-h-12 items-center rounded-xl px-6 text-sm font-semibold">See what a send would cost</a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">{['Free plan, no card', 'No markup on messages', 'Opt-outs always respected'].map((t) => <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-brand" />{t}</li>)}</ul>
          </div>
          <div className="reveal min-w-0 [animation-delay:0.15s]">
            <div className="glass rounded-3xl p-5" aria-label="Illustration: contacts who have never been messaged start replying">
              <p className="mb-3 flex items-center justify-between text-xs font-bold uppercase tracking-widest text-white/60"><span>Your contacts</span><span>Last message</span></p>
              {[['Ritika S.', 'Bought once · 5 months ago', 'Replied: “Send link”'], ['Arjun M.', 'Asked the price · last week', 'Booked a demo'], ['Mehta family', 'Walk-in · last year', 'Paid via link'], ['Sana P.', 'Facebook ad lead', 'Asked: “Open Sunday?”']].map(([n, s, r], i) => (
                <div key={n} className="relative flex items-center gap-3 border-t border-white/10 py-3 text-sm">
                  <span className="grad-bg flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">{n!.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{n}</span><span className="block truncate text-xs text-white/60">{s}</span></span>
                  <span className="relative block h-6 w-[8.5rem] shrink-0 overflow-hidden text-right text-[11px] sm:w-44 sm:text-xs"><span className="wake-old absolute inset-0 flex items-center justify-end whitespace-nowrap text-white/50" style={{ ['--d' as string]: `${i * 1.4}s` }}>Never messaged</span><span className="wake-new absolute inset-0 flex items-center justify-end whitespace-nowrap font-semibold text-brand" style={{ ['--d' as string]: `${i * 1.4}s` }}>{r}</span></span>
                </div>))}
              <p className="mt-2 text-[11px] text-white/45">Illustration with sample names. Not real customers.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Business-type marquee */}
      <section aria-label="Businesses this is built for" className="border-b border-line bg-card2 py-5">
        <div className="marquee overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          <ul className="marquee-track gap-3 pr-3">
            {[...business, ...business].map(([k, l], i) => <li key={`${k}${i}`} aria-hidden={i >= business.length} className="flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold"><Store className="size-4 text-brand" />{l}</li>)}
          </ul>
        </div>
      </section>

      {/* 3. THE LIST: six places */}
      <section id="list" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:py-28">
        <div className="sr max-w-3xl"><Eyebrow>You already have the list</Eyebrow><H2>Your contacts are sitting in six places. Bring them into one.</H2>
          <p className="mt-4 text-lg text-muted">Upload them all as a file. We clean the numbers, drop repeats, and show you every row we could not use and why, before anything is saved.</p></div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {sources.map(({ Icon, t, d }, i) => (
            <div key={t} className="sr flex gap-4 bg-card p-6" style={{ ['--i' as string]: i }}><Icon className="mt-1 size-6 shrink-0 text-brand" /><div><h3 className="font-display text-lg font-bold">{t}</h3><p className="mt-1 text-sm text-muted">{d}</p></div></div>))}
        </div>
        <div className="sr mt-8 grid items-center gap-6 rounded-3xl border border-line bg-card p-6 md:grid-cols-[1fr_1.1fr] md:p-8">
          <div><h3 className="font-display text-xl font-bold">Messy files are fine.</h3><ul className="mt-3 space-y-2 text-sm text-muted">{['Hindi or English column names', 'Numbers with spaces, dashes, a leading 0 or +91', 'Excel’s damaged long numbers are caught, with a fix', 'The same person twice in one file is counted once', 'A downloadable list of every skipped row'].map((x) => <li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />{x}</li>)}</ul></div>
          <Shot src="/shots/contacts.webp" alt="The LeadBotCloud Contacts screen with groups, tags and permission status" url="app.leadbotcloud.com/contacts" />
        </div>
      </section>

      {/* 4. WHY UNUSED: dark, problem framing */}
      <section className="aurora"><div className="blob" />
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <div className="sr max-w-3xl"><Eyebrow>Why the list stays unused</Eyebrow><H2>Most of your list has never had a single message from you.</H2><p className="mt-4 text-lg text-white/70">It is not laziness. The usual tools were not made for it.</p></div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[[Users, 'Lists stop at 256', 'The free WhatsApp Business app caps a broadcast list, so a big list means many lists and a lot of copy-pasting.'], [UserCheck, 'Only people who saved your number', 'A broadcast from the app reaches only contacts who have your number saved. Everyone else never sees it.'], [Ban, 'Bulk sending from a normal number gets flagged', 'A personal or small-business number is not built for bulk sending, and WhatsApp can restrict it.']].map(([I, t, d], i) => { const Icon = I as typeof Users; return (
              <div key={t as string} className="sr glass rounded-3xl p-6" style={{ ['--i' as string]: i }}><Icon className="mb-4 size-7 text-brand" /><h3 className="font-display text-xl font-bold">{t as string}</h3><p className="mt-2 text-sm text-white/70">{d as string}</p></div>); })}
          </div>
          <div className="sr mt-10 overflow-x-auto rounded-3xl border border-white/15 bg-white/5">
            <table className="w-full min-w-[34rem] text-sm"><caption className="sr-only">Example contacts and when they were last messaged</caption>
              <thead><tr className="text-left text-xs uppercase tracking-widest text-white/50"><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Came from</th><th className="px-5 py-3">Last message from you</th></tr></thead>
              <tbody>{[['Ritika S.', 'Past order', 'Never'], ['Arjun M.', 'Price enquiry', 'Never'], ['Mehta family', 'Walk-in', '5 months ago'], ['Sana P.', 'Facebook ad', 'Never'], ['Deepak R.', 'Website form', 'Never']].map(([a, b, c]) => <tr key={a} className="border-t border-white/10"><td className="px-5 py-3 font-semibold">{a}</td><td className="px-5 py-3 text-white/70">{b}</td><td className={cn('px-5 py-3', c === 'Never' ? 'font-semibold text-amber' : 'text-white/70')}>{c}</td></tr>)}</tbody></table>
            <p className="border-t border-white/10 px-5 py-3 text-xs text-white/50">Sample rows for illustration.</p>
          </div>
          <p className="sr mt-8 font-display text-2xl font-bold sm:text-3xl">They know you. They have not heard from you.</p>
        </div>
      </section>

      {/* 5. HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:py-28">
        <div className="sr max-w-3xl"><Eyebrow>How it works</Eyebrow><H2>From a silent list to replies in your inbox.</H2></div>
        <div className="mt-14 grid gap-14">
          {[
            { n: '1', t: 'Upload your contacts', d: 'Bring in every list as a file, or paste numbers. Tell us where each group agreed to hear from you. That one answer is saved as proof, with the date.', shot: { src: '/shots/contacts.webp', alt: 'Contacts screen', url: 'app.leadbotcloud.com/contacts' } },
            { n: '2', t: 'Check the cost, then send', d: 'Pick an approved message format and the groups. You see how many people get it, who is skipped, and the cost with GST before you press send. Add a spend cap and we refuse to go over it.', shot: { src: '/shots/send.webp', alt: 'Send to customers screen with the report', url: 'app.leadbotcloud.com/campaigns' } },
            { n: '3', t: 'Reply, renew, close', d: 'Replies land in a shared team inbox with assignment and private notes. Track who is due to renew, remind them, and mark the payment in one tap.', shot: { src: '/shots/chats.webp', alt: 'Shared team inbox', url: 'app.leadbotcloud.com/chats' } },
          ].map((s, i) => (
            <div key={s.n} className={cn('sr grid items-center gap-8 lg:grid-cols-2', i % 2 ? 'lg:[&>*:first-child]:order-2' : '')}>
              <div><span className="grad-bg mb-4 flex size-12 items-center justify-center rounded-2xl font-display text-xl font-extrabold text-white">{s.n}</span><h3 className="font-display text-2xl font-bold sm:text-3xl">{s.t}</h3><p className="mt-3 text-lg text-muted">{s.d}</p></div>
              <Shot {...s.shot} />
            </div>))}
        </div>
        <p className="mt-10 text-center text-sm text-muted">Screens are the real panel, shown with sample data. Sending is in test mode until your WhatsApp number is connected.</p>
      </section>

      {/* 6. WHAT TO SEND: six real examples */}
      <section id="messages" className="scroll-mt-20 bg-card2 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="sr max-w-3xl"><Eyebrow>What to send</Eyebrow><H2>Six messages your list is waiting to hear.</H2><p className="mt-4 text-lg text-muted">Not plain text. Add a photo, your customer’s name and buttons, so people can reply, call or pay right from the chat.</p></div>
          <div className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { h: 'Offers and launches', s: 'Photo + buttons', img: '/people/salon.webp', body: 'Hi Ritika, our festive collection is here. This weekend only, 20% off for returning customers.', btn: [{ label: 'Shop now', kind: 'url' }, { label: 'Talk to us', kind: 'reply' }], from: 'Your Boutique' },
              { h: 'Follow-ups on old enquiries', s: 'Photo + quick replies', img: '/people/coaching.webp', body: 'Hello Mr. Sharma, you asked about our NEET batch in March. A new batch starts Monday. Want a free demo class?', btn: [{ label: 'Book a demo', kind: 'reply' }, { label: 'Call me back', kind: 'reply' }], from: 'Your Institute' },
              { h: 'Appointment reminders', s: 'Quick replies', body: 'Hello Mrs. Gupta, a reminder for your appointment tomorrow at 5:00 PM.', btn: [{ label: 'Confirm', kind: 'reply' }, { label: 'Reschedule', kind: 'reply' }], from: 'Your Clinic', confirm: true },
              { h: 'Order and booking updates', s: 'Photo + link', img: '/people/online-store.webp', body: 'Hi Arjun, your order #1042 has shipped and will reach you by Friday.', btn: [{ label: 'Track order', kind: 'url' }], from: 'Your Store' },
              { h: 'Payment requests', s: 'Payment link', body: 'Hi Sneha, here is the payment link for your seat in the next batch: ₹4,500. Pay by UPI, card or net banking.', btn: [{ label: 'Pay now', kind: 'url' }, { label: 'I need help', kind: 'reply' }], from: 'Your Academy' },
              { h: 'Come-back messages', s: 'Photo + call button', img: '/people/gym.webp', body: 'Hi Pooja, it has been a while. Here is 15% off your next month, valid this week.', btn: [{ label: 'Rejoin now', kind: 'url' }, { label: 'Call us', kind: 'phone' }], from: 'Your Gym' },
            ].map((m, i) => (
              <div key={m.h} className="sr" style={{ ['--i' as string]: i }}>
                <h3 className="font-display text-xl font-bold">{m.h}</h3><p className="mb-3 text-xs font-semibold text-brand">{m.s}</p>
                <PhoneFrame title={m.from}><Bubble from={m.from} image={m.img} imageAlt="Illustrative photo" buttons={m.btn as never}>{m.body}</Bubble>{m.confirm ? <Reply_>Confirm</Reply_> : null}</PhoneFrame>
              </div>))}
          </div>
          <p className="mt-10 text-center text-sm text-muted">Sample messages with made-up names. Yours go out under your own business name using formats Meta has approved. Photos are illustrative stock images.</p>
        </div>
      </section>

      {/* 7. WHO IT'S FOR: photos */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <div className="sr max-w-3xl"><Eyebrow>Who it is for</Eyebrow><H2>Any business with a list of people who know it.</H2></div>
        <ul className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {business.map(([k, l], i) => (
            <li key={k} className="sr group relative overflow-hidden rounded-2xl" style={{ ['--i' as string]: i }}>
              <Image src={`/people/${k}.webp`} alt="" width={640} height={640} className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10"><span className="text-sm font-bold text-white sm:text-base">{l}</span></div>
            </li>))}
        </ul>
        <p className="mt-4 text-xs text-muted">Illustrative stock photos from Pexels. The people shown are not LeadBotCloud customers and do not endorse it. Sources are listed in our photo credits.</p>
      </section>

      {/* 8. SAFETY: the trust section */}
      <section id="safety" className="scroll-mt-20 aurora"><div className="blob" /><div className="aurora-grid" />
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <div className="sr max-w-3xl"><Eyebrow>Built to protect your number</Eyebrow><H2>The five checks that run before every send.</H2><p className="mt-4 text-lg text-white/70">Most panels let you send first and find out later. We show you first. Each of these is real and tested in the product today.</p></div>
          <ol className="mt-12 grid gap-4 md:grid-cols-2">
            {[[UserCheck, 'Permission on record', 'Only people marked as having agreed are messaged. Everyone else is skipped, counted, and listed in your report.'], [Ban, 'STOP is honoured instantly', 'When a customer writes STOP, they are opted out and logged with the date. The reply box then refuses to message them.'], [IndianRupee, 'Cost before you commit', 'Messages × rate + 18% GST is shown first, with an optional spend cap. If the estimate is over your cap, nothing is sent.'], [MessageSquareWarning, 'A pre-check on message formats', 'It warns about the things that get formats rejected: variables at the start or end, missing samples, banned wording, and offers filed as updates.'], [Lock, 'Your data stays yours', 'Each business is separated at the database level, with isolation tests. Exports and deletions are written to an audit log.']].map(([I, t, d], i) => { const Icon = I as typeof Lock; return (
              <li key={t as string} className={cn('sr glass flex gap-4 rounded-3xl p-6', i === 4 && 'md:col-span-2')} style={{ ['--i' as string]: i }}><span className="font-display text-3xl font-extrabold text-brand/80">{i + 1}</span><div><h3 className="flex items-center gap-2 font-display text-lg font-bold"><Icon className="size-5 text-brand" />{t as string}</h3><p className="mt-1.5 text-sm text-white/70">{d as string}</p></div></li>); })}
          </ol>
          <div className="sr mt-10 grid items-center gap-6 rounded-3xl border border-white/15 bg-white/5 p-6 md:grid-cols-[1fr_1fr] md:p-8">
            <div><h3 className="font-display text-xl font-bold">What we do not promise</h3><ul className="mt-3 space-y-2 text-sm text-white/75">{['We cannot guarantee Meta will never restrict an account. We reduce the risk and tell you early.', 'We cannot make Meta deliver every message. Meta blocks some promotional messages by its own per-person limit, and blocked ones are not charged.', 'Approval of a message format is Meta’s decision, not ours.'].map((x) => <li key={x} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-amber" />{x}</li>)}</ul></div>
            <div className="rounded-2xl bg-white/10 p-5 text-sm"><p className="font-semibold">Where we are today</p><p className="mt-1 text-white/70">The panel is fully built and runs in a clearly marked test mode. Connecting your real WhatsApp number is being switched on as our Meta partner approval completes. Nothing here pretends otherwise.</p></div>
          </div>
        </div>
      </section>

      {/* 9. THE CALCULATOR: out-of-the-box idea, grounded */}
      <section id="cost" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:py-28">
        <div className="sr max-w-3xl"><Eyebrow>Try it with your own numbers</Eyebrow><H2>What would one message to your sleeping list be worth?</H2><p className="mt-4 text-lg text-muted">Move the sliders to match your business. The cost is Meta’s real India rate. The sales are your own guess, so we start low and say so.</p></div>
        <div className="sr mt-10"><SleepingCalc /></div>
      </section>

      {/* 10. COMPARISON */}
      <section className="bg-card2 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-4">
          <div className="sr max-w-3xl"><Eyebrow>Why not the free app?</Eyebrow><H2>The Business app is for chatting. The API is for your whole list.</H2></div>
          <div className="sr mt-10 overflow-x-auto rounded-3xl border border-line bg-card">
            <table className="w-full min-w-[36rem] text-sm"><caption className="sr-only">WhatsApp Business app compared with LeadBotCloud</caption>
              <thead><tr className="border-b border-line text-left"><th className="px-5 py-4"><span className="sr-only">Feature</span></th><th className="px-5 py-4 font-display text-base font-bold">WhatsApp Business app</th><th className="grad-bg px-5 py-4 font-display text-base font-bold text-white">LeadBotCloud</th></tr></thead>
              <tbody>{[['Broadcasts', 'Capped lists of 256', 'No list cap. Upload your whole list.'], ['Who receives it', 'Only people who saved your number', 'Everyone who agreed to messages'], ['Team', 'One phone and a few linked devices', 'Shared inbox with assignment and notes'], ['Cost view', 'None', 'Cost with GST shown before every send'], ['Opted-out people', 'You remember to skip them', 'Skipped automatically and logged'], ['Message formats', 'Free-form broadcasts', 'Meta-approved formats, with a rejection pre-check'], ['Bulk sending risk', 'Number can be flagged', 'Checks and limits built to protect your number']].map(([a, b, c]) => <tr key={a} className="border-b border-line last:border-0"><th scope="row" className="px-5 py-3.5 text-left font-semibold">{a}</th><td className="px-5 py-3.5 text-muted">{b}</td><td className="px-5 py-3.5 font-medium">{c}</td></tr>)}</tbody></table>
          </div>
          <p className="mt-3 text-xs text-muted">The API route has rules of its own: approved message formats, recorded permission, and per-message charges from Meta.</p>
        </div>
      </section>

      {/* 11. RENEWALS: the wedge */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="sr"><Eyebrow>For anyone who sells by the month</Eyebrow><H2>Stop losing customers to a forgotten due date.</H2>
            <p className="mt-4 text-lg text-muted">Gyms, coaching, internet, subscriptions, tuition. Add the plan and the due date. See who is overdue and who is due this week, remind them, and mark the payment received.</p>
            <ul className="mt-6 space-y-3 text-sm">{['Due this week, overdue, renewed this month, with rupee totals', 'One tap to remind, and one tap to mark paid', 'Reminders are promotional messages, and the cost is shown. We do not pretend they are cheaper.', 'Payment links through Razorpay are coming next'].map((x, i) => <li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />{x}{i === 3 ? <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-bold text-amber">Soon</span> : null}</li>)}</ul></div>
          <div className="sr"><Shot src="/shots/renewals.webp" alt="The Renewals screen showing due soon, overdue and recovered amounts" url="app.leadbotcloud.com/renewals" /></div>
        </div>
      </section>

      {/* 12. PRICING */}
      <section id="pricing" className="scroll-mt-20 border-t border-line bg-card2 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="sr text-center"><Eyebrow>Pricing</Eyebrow><H2>Simple monthly plans.</H2><p className="mx-auto mt-3 max-w-xl text-muted">Plan prices exclude GST. WhatsApp message charges are paid to Meta separately, at Meta’s rate with no markup from us.</p></div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => { const l = PLAN_LIMITS[p.id]; return (
              <div key={p.id} className={cn('card relative flex flex-col p-6', 'hot' in p && 'border-brand ring-2 ring-brand/30')}>
                {'hot' in p ? <span className="grad-bg absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-bold text-white">Most popular</span> : null}
                <h3 className="font-display text-lg font-bold">{l.label}</h3><p className="text-xs text-muted">{p.note}</p>
                <p className="mt-4 font-display text-4xl font-extrabold">{p.price}<span className="text-sm font-medium text-muted">/month</span></p>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm"><li className="flex gap-2"><Users className="mt-0.5 size-4 shrink-0 text-brand" />{l.users} {l.users === 1 ? 'user' : 'users'}, {l.contacts.toLocaleString('en-IN')} contacts</li>{p.pts.map((x) => <li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />{x}</li>)}</ul>
                <Button asChild variant={'hot' in p ? 'primary' : 'outline'} className="mt-6 w-full"><Link href={session ? '/dashboard' : '/signup'}>{p.id === 'free' ? 'Start free' : `Start free, upgrade later`}</Link></Button>
              </div>); })}
          </div>
          <p className="mt-6 text-center text-xs text-muted">Online payment is being switched on. Until then every account starts on the free plan, and you are never charged without a card on file.</p>
        </div>
      </section>

      {/* 13. FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:py-28">
        <div className="sr mb-10 text-center"><Eyebrow>Questions</Eyebrow><H2>Before you sign up.</H2></div>
        <div className="space-y-3">{faqs.map(([q, a]) => (
          <details key={q} className="card group p-0"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-semibold">{q}<span className="text-2xl leading-none text-brand transition-transform group-open:rotate-45" aria-hidden="true">+</span></summary><p className="px-5 pb-5 text-sm text-muted">{a}</p></details>))}</div>
      </section>

      {/* 14. FINAL CTA */}
      <section className="aurora"><div className="blob" /><div className="aurora-grid" />
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
          <H2>They already know you. Say something.</H2>
          <p className="mt-4 text-lg text-white/75">Create a free workspace in a minute. Upload a list, see the cost, and try the whole panel before you spend a rupee.</p>
          <Button asChild size="lg" className="mt-8"><Link href={cta.href}>{cta.label}<ArrowRight className="size-5" /></Link></Button>
          <p className="mt-4 text-xs text-white/55">Free plan, no card. Message charges are set by Meta and billed separately.</p>
        </div>
      </section>

      <footer className="border-t border-line px-4 py-10 text-sm text-muted">
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div><p className="flex items-center gap-2 font-display text-lg font-extrabold text-ink"><span className="grad-bg flex size-8 items-center justify-center rounded-lg text-white">L</span>LeadBotCloud</p><p className="mt-3 max-w-sm">WhatsApp marketing for Indian businesses. A product of DigiXoMedia.</p></div>
          <div><p className="mb-2 font-semibold text-ink">Product</p><ul>{[['#how', 'How it works'], ['#safety', 'Safety'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']].map(([h, l]) => <li key={h}><a href={h} className="flex min-h-11 items-center hover:text-ink">{l}</a></li>)}</ul></div>
          <div><p className="mb-2 font-semibold text-ink">Account</p><ul><li><Link href="/login" className="flex min-h-11 items-center hover:text-ink">Log in</Link></li><li><Link href="/signup" className="flex min-h-11 items-center hover:text-ink">Create account</Link></li></ul></div>
        </div>
        <div className="mx-auto mt-8 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs">
          <p>© {new Date().getFullYear()} LeadBotCloud, a product of DigiXoMedia.</p>
          <p className="max-w-lg">WhatsApp is a trademark of Meta Platforms, Inc. LeadBotCloud is not affiliated with or endorsed by Meta. Photos are illustrative stock images from Pexels.</p>
        </div>
      </footer>
    </div>
  );
}

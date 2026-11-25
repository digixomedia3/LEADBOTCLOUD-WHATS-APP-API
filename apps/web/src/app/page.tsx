import type { Metadata } from 'next';
import { PLAN_LIMITS, PLAN_PRICE_PAISE, TEMPLATE_LIBRARY, priceWithGst, type PaidPlanId } from '@lbc/shared';
import { estimateCost, RATE_PAISE_X100 } from '@/lib/cost';
import { company } from '@/lib/company';
import { getSession } from '@/lib/session';
import { SiteHeader } from '@/components/home/site-header';
import { Hero } from '@/components/home/hero';
import { HowItWorks } from '@/components/home/how-it-works';
import { Flows, type FlowData } from '@/components/home/flows';
import { CostCheck } from '@/components/home/cost-check';
import { Safety, type SafetyNode } from '@/components/home/safety';
import { Compare, Pricing, type PlanCard } from '@/components/home/compare-pricing';
import { Closing, Faq, ProofBar } from '@/components/home/sections';
import { RevealObserver, StickyCta } from '@/components/home/client-kit';
import type { Tone } from '@/components/home/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'LeadBotcloud — Turn Every Chat Into a Qualified Sale',
  description: 'Capture leads from ads, forms and your store, follow up automatically on WhatsApp, and see the cost before you send. Official WhatsApp Business Platform, no markup on Meta’s charges.',
  openGraph: { type: 'website', siteName: 'LeadBotCloud', title: 'Turn every chat into a qualified sale', description: 'WhatsApp lead capture, follow-up flows and campaigns for Indian businesses. Cost shown before every send.' },
  twitter: { card: 'summary_large_image' },
};

/* ---- Flows: six real templates from the library, filled with their own sample values ---- */
const FLOW_PICKS: { tpl: string; title: string; icon: string; tone: Tone; trigger: string; outcome: string; reply: string; replyKind: 'tap' | 'link'; result: string }[] = [
  { tpl: 'lead_follow_up', title: 'Lead follow-up', icon: 'users', tone: 'indigo', trigger: 'A new enquiry comes in', outcome: 'Hot leads tagged and assigned', reply: 'Yes, share options', replyKind: 'tap', result: 'Tagged Hot · assigned to Riya' },
  { tpl: 'abandoned_cart', title: 'Items left in cart', icon: 'cart', tone: 'amber', trigger: 'A Shopify checkout is left unpaid', outcome: 'Orders completed', reply: 'Complete order', replyKind: 'link', result: 'Opened checkout link' },
  { tpl: 'cod_confirm', title: 'Confirm cash on delivery', icon: 'truck', tone: 'emerald', trigger: 'You tag an order “COD”', outcome: 'Only confirmed orders ship', reply: 'Confirm order', replyKind: 'tap', result: 'Order #1042 confirmed' },
  { tpl: 'appointment_reminder', title: 'Appointment reminder', icon: 'calendar', tone: 'indigo', trigger: 'Send to tomorrow’s bookings', outcome: 'Fewer no-shows', reply: 'Yes, confirm', replyKind: 'tap', result: 'Visit confirmed for 12 Nov' },
  { tpl: 'renewal_reminder', title: 'Renewal reminder', icon: 'repeat', tone: 'emerald', trigger: 'A plan is about to end', outcome: 'Renewed through the link', reply: 'Renew now', replyKind: 'link', result: 'Paid · marked by itself' },
  { tpl: 'festival_offer', title: 'Festival offer', icon: 'gift', tone: 'amber', trigger: 'You pick a list and press send', outcome: 'Replies land in the inbox', reply: 'Yes, tell me more', replyKind: 'tap', result: 'Reply assigned to Riya' },
];
const fill = (s: string, samples: string[]) => s.replace(/\{\{(\d+)\}\}/g, (_, n: string) => samples[Number(n) - 1] ?? '');
const perMessage = (cat: string) => '₹' + (estimateCost(10_000, cat).totalPaise / 10_000 / 100).toFixed(2);

function flows(): FlowData[] {
  return FLOW_PICKS.flatMap((p) => {
    const item = TEMPLATE_LIBRARY.find((t) => t.id === p.tpl);
    if (!item) return [];
    const d = item.draft;
    const category = d.category === 'utility' ? 'utility' : 'marketing';
    return [{
      id: p.tpl, title: p.title, template: item.title, icon: p.icon, tone: p.tone, trigger: p.trigger, outcome: p.outcome, category, perMessage: perMessage(category),
      header: d.headerText || undefined, body: fill(d.body, d.samples), footer: d.footer || undefined,
      buttons: (d.buttons ?? []).map((b) => ({ type: b.type, text: b.text })), reply: p.reply, replyKind: p.replyKind, result: p.result,
    }];
  });
}

/* ---- Safety: a sample list of 3,000; the cost node is lib/cost on the people left ---- */
function safetyNodes(): SafetyNode[] {
  const left = 2064;
  return [
    { icon: 'list', title: 'Your list', value: '3,000', unit: 'contacts uploaded', note: 'Upload everyone. Nobody is messaged yet.' },
    { icon: 'users', title: 'Permission on record', value: '2,100', unit: 'can be messaged', skip: '900 never agreed', note: 'Only people with a recorded opt-in get promotions.' },
    { icon: 'stop', title: 'STOP honoured', value: '2,064', unit: 'still opted in', skip: '36 said STOP before', note: 'Opt-outs are logged with the date, forever.' },
    { icon: 'doc', title: 'Template check', value: 'Passed', unit: 'no rejection triggers', note: 'Flags what gets templates rejected before you submit.' },
    { icon: 'gauge', title: 'Limit, cost & cap', value: estimateCost(left, 'marketing').totalLabel.replace(/\.\d\d$/, ''), unit: 'incl. GST, under cap', note: 'Daily limit and quality checked; over your cap, nothing is sent.' },
    { icon: 'send', title: 'Sent', value: left.toLocaleString('en-IN'), unit: 'people messaged', note: 'Every skip is listed in your report with the reason.' },
  ];
}

/* ---- Pricing: prices from billing, limits from plans ---- */
const PLAN_COPY: Record<string, { note: string; points: string[] }> = {
  free: { note: 'Try it properly', points: ['Shared inbox', 'Templates and the checker', '2 campaigns a month', 'Auto-replies (3 rules)'] },
  starter: { note: 'One shop or team', points: ['Unlimited campaigns', 'Auto-replies', 'Ready-made templates'] },
  growth: { note: 'Teams that follow up', points: ['Renewal reminders', 'Number health centre', 'Everything in Starter'] },
  pro: { note: 'Bigger teams', points: ['3 WhatsApp numbers', 'API access and webhooks', 'Priority support'] },
};
function plans(): PlanCard[] {
  const rupees = (p: number) => '₹' + Math.round(p / 100).toLocaleString('en-IN');
  return (['free', 'starter', 'growth', 'pro'] as const).map((id) => {
    const paid = id !== 'free' ? priceWithGst(PLAN_PRICE_PAISE[id as PaidPlanId]) : null;
    return {
      id, label: PLAN_LIMITS[id].label, contacts: PLAN_LIMITS[id].contacts, users: PLAN_LIMITS[id].users, ...PLAN_COPY[id]!,
      price: paid ? rupees(paid.basePaise) : '₹0',
      gstNote: paid ? `+ 18% GST (${rupees(paid.totalPaise)} in total)` : 'No card needed',
    };
  });
}

const FAQS: [string, string][] = [
  ['Is this the official WhatsApp Business Platform?', 'Yes. You connect your own WhatsApp Business account through Meta’s Embedded Signup, so your number, your account and your message history stay yours. That connection step is being switched on now; until then the panel runs in a clearly marked test mode, and you can try every screen.'],
  ['What will I pay in total?', 'Our plan fee plus GST, and Meta’s own message charges, which Meta bills to you. We add no markup on messages. The calculator above uses ₹0.8631 per promotional message and ₹0.115 per update, before 18% GST. Meta changes its rates, so the live cost preview before every send is what counts.'],
  ['Can I message my whole contact list?', 'You can upload everyone. Promotions go only to people with a permission on record: you tell us where each person agreed, and we keep that record. People without one are skipped and counted, so you always see who was left out and why.'],
  ['How does the automatic follow-up work?', 'You build a flow from steps: send a template, wait, check whether they replied or clicked, add a tag, assign a teammate. It starts on a new lead, a tag, or when you press start, and stops by itself when the person replies, opts out or cannot be reached.'],
  ['Where do leads come from?', 'Click-to-WhatsApp ads, a button on your website, hosted forms with QR codes, Meta Lead Ads, Shopify, Google Sheets, IndiaMART, JustDial, a CSV file, or any tool that can send a signed webhook. Duplicates are merged.'],
  ['What stops my number from being restricted?', 'Opted-out people are never messaged. We check your daily limit and quality rating before a send, warn you when a template is likely to be rejected, and show the cost before you commit. Nobody can promise Meta will never act on an account; sending messages people welcome is what keeps a number healthy.'],
  ['Why would some messages not arrive?', 'Meta limits how many promotional messages one person can receive from all businesses combined. Messages Meta holds back for this reason are not charged, and we show them in your report instead of hiding them.'],
  ['Which businesses cannot use LeadBotCloud?', 'Crypto and trading, gambling, adult content and anything else WhatsApp’s Commerce Policy bans. Loans, insurance, healthcare and a few others go through a short review. We would rather say no at signup than see your number blocked later.'],
  ['Is my customer data separate from other businesses?', 'Yes. Each workspace is separated inside the database itself, not only in our code, and we test that one business cannot read another’s contacts, chats or campaigns. Every export and delete is written to an audit log.'],
  ['Do I need a contract, or a card to start?', 'No contract: plans are monthly. Online payment is being switched on, so today every workspace starts on the free plan without a card.'],
];

export default async function Landing() {
  const session = await getSession();
  const loggedIn = !!session;
  const href = loggedIn ? '/dashboard' : '/signup';
  const c = company();
  const wa = c.supportWhatsapp?.replace(/\D/g, '') || null;
  const waHref = wa ? `https://wa.me/${wa}` : null;
  // Hero proof points: only things that are true today (the draft's speed/conversion/open-rate figures were not measured).
  const heroStats = [
    { v: '₹0', l: 'Markup on Meta fees', accent: true },
    { v: '₹' + (RATE_PAISE_X100.marketing / 10000).toFixed(2), l: 'Meta fee per promo, + GST' },
    { v: String(TEMPLATE_LIBRARY.length), l: 'Ready-made templates' },
  ];

  return (
    <div className="hx isolate relative min-h-screen overflow-x-clip bg-[#FAFAFC] dark:bg-[#060A13] text-[#0F172A] dark:text-[#F8FAFC] transition-colors duration-300 selection:bg-emerald-500/20 selection:text-emerald-700 dark:selection:text-emerald-300">
      <noscript><style>{'.hx .sr-in{opacity:1;transform:none}'}</style></noscript>
      <RevealObserver />
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
        <div className="absolute inset-0 bg-dot-grid opacity-100" />
        <div className="absolute -top-28 -left-24 w-[520px] h-[520px] rounded-full bg-[#EEF2FF] dark:bg-indigo-600/15 blur-[110px] opacity-90 dark:opacity-70 transition-colors duration-500" />
        <div className="absolute top-12 right-[-6%] w-[620px] h-[620px] rounded-full bg-[#ECFDF5] dark:bg-emerald-500/12 blur-[120px] opacity-95 dark:opacity-75 transition-colors duration-500" />
        <div className="absolute bottom-[-120px] left-[32%] w-[460px] h-[340px] rounded-full bg-emerald-50/80 dark:bg-indigo-500/10 blur-[100px]" />
      </div>

      <SiteHeader ctaHref={href} ctaLabel={loggedIn ? 'Dashboard' : 'Start Free'} loggedIn={loggedIn} />
      <Hero ctaHref={href} ctaLabel={loggedIn ? 'Open your dashboard' : 'Start Free Trial'} stats={heroStats} />
      <ProofBar />
      <HowItWorks />
      <Flows flows={flows()} libraryCount={TEMPLATE_LIBRARY.length} ctaHref={href} />
      <CostCheck ctaHref={href} />
      <Safety nodes={safetyNodes()} />
      <Compare proContacts={PLAN_LIMITS.pro.contacts} ctaHref={href} ctaLabel={loggedIn ? 'Open dashboard' : 'Start free'} />
      <Pricing plans={plans()} ctaHref={href} ctaLabel={loggedIn ? 'Open dashboard' : 'Start free'} />
      <Faq faqs={FAQS} waHref={waHref} />
      <Closing ctaHref={href} ctaLabel={loggedIn ? 'Open your dashboard' : 'Start Free Trial'} waHref={waHref} legalName={c.legalName} address={c.address} supportEmail={c.supportEmail} />
      <StickyCta href={href} label={loggedIn ? 'Open your dashboard' : 'Start Free Trial'} />
    </div>
  );
}

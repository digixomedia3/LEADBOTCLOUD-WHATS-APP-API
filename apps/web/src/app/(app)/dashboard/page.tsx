import Link from 'next/link';
import { ArrowRight, CalendarClock, CheckCircle2, Circle, MessageCircle, Plus, Send, Sparkles, TrendingUp, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CountUp } from '@/components/dashboard/count-up';
import { PerformanceChart, type Point } from '@/components/dashboard/performance-chart';
import { Ring } from '@/components/dashboard/ring';
import { Sparkline } from '@/components/dashboard/sparkline';

/** SAMPLE DATA for the design preview. Replaced by real queries in the backend phases. */
const days = ['1 Nov', '2', '3 Nov', '4', '5 Nov', '6', '7 Nov', '8', '9 Nov', '10', '11 Nov', '12', '13 Nov', '14'];
const sent = [220, 340, 280, 410, 380, 520, 460, 880, 640, 590, 720, 680, 910, 840];
const chart: Point[] = days.map((label, i) => ({ label, sent: sent[i]!, delivered: Math.round(sent[i]! * 0.95), read: Math.round(sent[i]! * 0.62) }));

const kpis = [
  { label: 'Messages sent', value: 6840, delta: '+18%', data: [4, 5, 5, 7, 6, 9, 8, 11, 10, 13], color: '#6366f1', suffix: '' },
  { label: 'Delivered', value: 95, delta: '+1.2%', data: [90, 92, 93, 92, 94, 95, 94, 95, 96, 95], color: '#06b6d4', suffix: '%' },
  { label: 'Read rate', value: 62, delta: '+4%', data: [48, 50, 53, 52, 56, 58, 57, 60, 61, 62], color: '#10b981', suffix: '%' },
  { label: 'Replies', value: 412, delta: '+26%', data: [20, 28, 26, 35, 40, 38, 52, 49, 60, 66], color: '#f59e0b', suffix: '' },
];

const scheduled = [
  { name: 'Diwali offer', when: 'Today, 6:30 pm', n: 1240, tpl: 'diwali_offer_2026' },
  { name: 'Renewal reminder', when: 'Tomorrow, 10:00 am', n: 220, tpl: 'renewal_7d' },
  { name: 'New plan launch', when: '15 Nov, 10:30 am', n: 3500, tpl: 'new_plan_launch' },
];
const chats = [
  { n: 'Asha Verma', m: 'Yes please send the payment link', t: '2m', u: 2 },
  { n: 'Imran Khan', m: 'Can I pay by UPI?', t: '1h', u: 1 },
  { n: 'Rohit Singh', m: 'Thanks, got it', t: '3h', u: 0 },
];
const steps = [
  { done: true, label: 'Connect WhatsApp', href: '/settings' },
  { done: true, label: 'Add contacts', href: '/contacts' },
  { done: true, label: 'Get a template approved', href: '/templates' },
  { done: false, label: 'Send your first campaign', href: '/campaigns' },
  { done: false, label: 'Turn on renewal reminders', href: '/renewals' },
];

export default function DashboardPage() {
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber">Design preview: numbers on this screen are sample data.</div>

      {/* Hero */}
      <section className="aurora reveal rounded-3xl p-6 md:p-8" style={{ ['--i' as string]: 0 }}>
        <span className="blob" /><span className="aurora-grid" />
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold"><Sparkles className="size-3.5 text-emerald-300" />Good morning, DiGiXO Store</p>
            <h2 className="font-display text-3xl font-extrabold leading-tight md:text-4xl">Your WhatsApp is <span className="grad-text">working for you</span></h2>
            <p className="mt-2 text-sm text-white/75 md:text-base">412 replies this week. 6 renewals are due. One campaign goes out today at 6:30 pm.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button asChild><Link href="/campaigns"><Send className="size-4" />Create campaign</Link></Button>
              <Button asChild variant="glass"><Link href="/contacts"><Upload className="size-4" />Import contacts</Link></Button>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <Ring value={86} label="Number health" sub="Health" />
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-center gap-2"><span className="live-dot size-2.5 rounded-full bg-emerald-400" />Quality: High</li>
              <li className="text-white/80">Daily limit: <strong className="text-white">420 / 1,000</strong></li>
              <li className="text-white/80">Status: <strong className="text-emerald-300">LIVE</strong></li>
            </ul>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key numbers">
        {kpis.map((k, i) => (
          <article key={k.label} className="card card-hover reveal p-4 md:p-5" style={{ ['--i' as string]: i + 1 }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted md:text-sm">{k.label}</p>
              <span className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand"><TrendingUp className="size-3" />{k.delta}</span>
            </div>
            <p className="font-display mt-2 text-3xl font-extrabold md:text-4xl"><CountUp to={k.value} suffix={k.suffix} /></p>
            <div className="mt-2"><Sparkline data={k.data} color={k.color} /></div>
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="card reveal p-5 md:p-6" style={{ ['--i' as string]: 5 }}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="font-display text-lg font-bold">Campaign performance</h3><p className="text-sm text-muted">Last 14 days</p></div>
              <Button asChild variant="soft" size="sm"><Link href="/analytics">Open analytics <ArrowRight className="size-4" /></Link></Button>
            </div>
            <PerformanceChart data={chart} />
          </section>

          <section className="card reveal p-5 md:p-6" style={{ ['--i' as string]: 6 }}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-display flex items-center gap-2 text-lg font-bold"><CalendarClock className="size-5 text-indigo" />Scheduled campaigns</h3><Button asChild variant="soft" size="sm"><Link href="/campaigns"><Plus className="size-4" />New</Link></Button></div>
            <ul className="flex flex-col gap-2">
              {scheduled.map((s) => (
                <li key={s.name} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card2 p-3">
                  <span className="grad-bg flex size-10 items-center justify-center rounded-xl text-white"><Send className="size-[18px]" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{s.name}</span><span className="block truncate text-xs text-muted">{s.when} · <span className="font-mono">{s.tpl}</span></span></span>
                  <span className="rounded-full bg-indigo/10 px-3 py-1 text-xs font-bold text-indigo tabular">{s.n.toLocaleString('en-IN')} contacts</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="card reveal p-5" style={{ ['--i' as string]: 5 }}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-display flex items-center gap-2 text-lg font-bold"><MessageCircle className="size-5 text-brand" />Live chats</h3><Link href="/chats" className="flex min-h-11 items-center px-2 text-sm font-semibold text-brand">Open</Link></div>
            <ul className="flex flex-col">
              {chats.map((c) => (
                <li key={c.n}>
                  <Link href="/chats" className="flex min-h-14 items-center gap-3 rounded-xl px-2 hover:bg-ink/5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-bold text-brand">{c.n.split(' ').map((p) => p[0]).join('')}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.n}</span><span className="block truncate text-xs text-muted">{c.m}</span></span>
                    <span className="flex flex-col items-end gap-1 text-[11px] text-muted">{c.t}{c.u ? <span className="grad-bg rounded-full px-1.5 font-bold text-white">{c.u}</span> : null}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="card reveal p-5" style={{ ['--i' as string]: 6 }}>
            <div className="mb-2 flex items-center justify-between"><h3 className="font-display text-lg font-bold">Getting started</h3><span className="text-xs font-semibold text-muted">{doneCount} of {steps.length}</span></div>
            <div className="mb-2 h-2 overflow-hidden rounded-full bg-line"><div className="grad-bg h-full rounded-full transition-all duration-1000" style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
            <ul>
              {steps.map((s) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex min-h-11 items-center gap-3 text-sm">
                    {s.done ? <CheckCircle2 className="size-5 text-brand" /> : <Circle className="size-5 text-muted" />}
                    <span className={s.done ? 'text-muted line-through' : 'font-semibold'}>{s.label}</span>
                    {!s.done ? <ArrowRight className="ml-auto size-4 text-brand" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { chats, campaigns } from '@/lib/demo-data';
import { inr, num, pct } from '@/lib/format';
import { numberStatus } from '@/lib/number-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Stat } from '@/components/ui/table';
import { DemoBanner } from '@/components/demo-banner';

const steps = [
  { done: true, label: 'Connect WhatsApp', href: '/connect' },
  { done: true, label: 'Add contacts', href: '/customers/import' },
  { done: true, label: 'Get a template approved', href: '/formats' },
  { done: false, label: 'Send your first campaign', href: '/send/new' },
  { done: false, label: 'Set up renewals', href: '/renewals' },
];

export default function HomePage() {
  const last = campaigns[0]!;
  const waiting = chats.filter((c) => c.unread > 0 || c.assignee === null).length;
  const doneCount = steps.filter((s) => s.done).length;
  const pctRead = Math.round((last.read / last.sent) * 100);
  const circ = 2 * Math.PI * 52;

  return (
    <div className="flex flex-col gap-4">
      <DemoBanner />

      <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <p><strong>Before 31 Dec 2026:</strong> your WhatsApp account must be billed in Indian rupees, or messages will stop on 1 Jan 2027.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Messages this month" value={num(2480)} sub="Sent from your number" />
            <Stat label="Spend (estimate)" value={inr(126012)} sub="Paid to Meta. We add nothing." />
            <Stat label="Chats waiting" value={waiting} sub="Unread or not assigned" />
            <Stat label="Recovered by renewals" value={inr(49900)} sub="This month" />
          </div>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Last campaign: {last.name}</h3>
              <Link href={`/send/${last.id}`} className="text-sm font-semibold text-primary">View report</Link>
            </div>
            <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
              <div className="relative size-32 shrink-0">
                <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label={`${pctRead}% read`}>
                  <circle cx="60" cy="60" r="52" fill="none" strokeWidth="12" className="stroke-muted" />
                  <circle cx="60" cy="60" r="52" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-primary" strokeDasharray={circ} strokeDashoffset={circ * (1 - pctRead / 100)} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-bold">{pctRead}%</span><span className="text-[11px] text-muted-foreground">read</span></div>
              </div>
              <dl className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                {[['Sent', num(last.sent)], ['Delivered', pct(last.delivered, last.sent)], ['Read', pct(last.read, last.sent)], ['Replied', num(last.replied)]].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/60 p-3 text-center"><dd className="text-xl font-bold">{v}</dd><dt className="text-xs text-muted-foreground">{k}</dt></div>
                ))}
              </dl>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { href: '/send/new', Icon: Send, t: 'Create Campaign', d: 'Send an approved template' },
              { href: '/chats', Icon: MessageSquare, t: 'Open Live Chat', d: `${waiting} chats waiting` },
              { href: '/renewals', Icon: RefreshCw, t: 'Renewals', d: '6 due this week' },
            ].map(({ href, Icon, t, d }) => (
              <Link key={href} href={href} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
                <span><span className="block font-semibold">{t}</span><span className="text-xs text-muted-foreground">{d}</span></span>
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-border bg-card p-5 text-center">
            <Badge tone="green" className="mb-3">Growth plan</Badge>
            <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-[#0b3b36] text-2xl font-black text-green-300">D</div>
            <p className="mt-3 text-lg font-bold">{numberStatus.displayName}</p>
            <p className="font-mono text-sm text-muted-foreground">{numberStatus.phone}</p>
            <div className="mt-3 flex justify-center gap-2"><Badge tone="green">Quality: High</Badge><Badge tone="green">LIVE</Badge></div>
            <div className="mt-4 text-left text-sm">
              <div className="mb-1 flex justify-between"><span>Daily limit used</span><span>{1000 - numberStatus.remainingQuota} / 1,000</span></div>
              <Progress value={((1000 - numberStatus.remainingQuota) / 1000) * 100} label="Daily limit used" />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Getting started</h3><span className="text-xs text-muted-foreground">{doneCount}/{steps.length}</span></div>
            <Progress value={(doneCount / steps.length) * 100} label="Setup progress" />
            <ul className="mt-2 flex flex-col">
              {steps.map((s) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex min-h-11 items-center gap-3 text-sm">
                    {s.done ? <CheckCircle2 className="size-5 text-primary" /> : <Circle className="size-5 text-muted-foreground" />}
                    <span className={s.done ? 'text-muted-foreground line-through' : 'font-semibold'}>{s.label}</span>
                    {!s.done ? <ArrowRight className="ml-auto size-4" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm" className="mt-2 w-full"><Link href="/connect">WhatsApp connection</Link></Button>
          </section>
        </div>
      </div>
    </div>
  );
}

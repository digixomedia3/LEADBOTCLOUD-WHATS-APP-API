import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, MessageCircle } from 'lucide-react';
import { chats, campaigns } from '@/lib/demo-data';
import { inr, num, pct } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';

const steps = [
  { done: true, label: 'Connect WhatsApp', href: '/connect' },
  { done: true, label: 'Add customers', href: '/customers/import' },
  { done: true, label: 'Get a message format approved', href: '/formats' },
  { done: false, label: 'Send your first message', href: '/send/new' },
  { done: false, label: 'Set up renewals', href: '/renewals' },
];

export default function HomePage() {
  const last = campaigns[0]!;
  const pending = chats.filter((c) => c.unread > 0 || c.assignee === null);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Good morning" subtitle="DiGiXO Store" />
      <DemoBanner />

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between"><CardTitle>Getting started</CardTitle><span className="text-xs font-semibold text-muted-foreground">{doneCount} of {steps.length} done</span></div>
        <Progress value={(doneCount / steps.length) * 100} label="Setup progress" />
        <ul className="flex flex-col">
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
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardTitle>This month&apos;s WhatsApp spend</CardTitle>
          <p className="mt-2 text-3xl font-bold">{inr(126012)}</p>
          <p className="text-xs text-muted-foreground">Estimate. Charged by Meta to your card. We add nothing.</p>
        </Card>
        <Card>
          <CardTitle>Last send: {last.name}</CardTitle>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            {[['Delivered', pct(last.delivered, last.sent)], ['Read', pct(last.read, last.sent)], ['Replies', num(last.replied)]].map(([k, v]) => (
              <div key={k}><p className="text-xl font-bold">{v}</p><p className="text-[11px] text-muted-foreground">{k}</p></div>
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle>Number health</CardTitle>
          <div className="mt-2 flex items-center gap-3"><span className="text-3xl font-bold text-primary">86</span><Badge tone="green">🟢 Safe</Badge></div>
          <Link href="/health" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary">See details</Link>
        </Card>
        <Card>
          <CardTitle>Chats waiting</CardTitle>
          <p className="mt-2 text-3xl font-bold">{pending.length}</p>
          <Link href="/chats" className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary"><MessageCircle className="size-4" />Open chats</Link>
        </Card>
      </div>

      <Card className="flex items-center gap-4 border-primary/40 bg-primary/5">
        <div className="flex-1">
          <CardTitle>Renewals</CardTitle>
          <p className="mt-1 text-sm">6 due this week · <strong>{inr(49900)}</strong> recovered this month</p>
        </div>
        <Button asChild size="sm"><Link href="/renewals">Open</Link></Button>
      </Card>

      <Card className="flex gap-3 border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <div className="text-sm"><p className="font-semibold">Do this before 31 Dec 2026</p><p>Your WhatsApp account must be billed in Indian rupees or messages will stop on 1 Jan 2027.</p></div>
      </Card>
    </div>
  );
}

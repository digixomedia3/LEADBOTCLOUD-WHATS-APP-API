import { Check } from 'lucide-react';
import { planPrices } from '@/lib/demo-data';
import { inr } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';

export default function BillingPage() {
  return (
    <div>
      <PageHeader title="Plan and billing" subtitle="Your LeadBotCloud plan. WhatsApp message charges are separate and paid to Meta." />
      <DemoBanner />
      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between"><CardTitle>Your plan</CardTitle><Badge tone="green">Growth</Badge></div>
        <p className="text-2xl font-bold">{inr(129900)}<span className="text-sm font-normal text-muted-foreground"> a month + 18% GST</span></p>
        <p className="text-sm text-muted-foreground">Next payment 1 Dec 2026. Cancel any time and keep access until then.</p>
        <div className="flex flex-col gap-2 text-sm">
          <div><div className="mb-1 flex justify-between"><span>Customers</span><span>1,500 of 25,000</span></div><Progress value={6} label="Customers used" /></div>
          <div><div className="mb-1 flex justify-between"><span>Team members</span><span>3 of 5</span></div><Progress value={60} label="Team members used" /></div>
        </div>
        <Button variant="outline">Cancel plan</Button>
      </Card>
      <p className="mb-2 font-semibold">Change plan</p>
      <ul className="mb-4 flex flex-col gap-3">
        {planPrices.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex-1"><p className="font-semibold">{p.name}</p><p className="text-sm text-muted-foreground">{p.line}</p></div>
            <div className="text-right"><p className="font-bold">{p.pricePaise ? inr(p.pricePaise) : 'Free'}</p>{p.id === 'growth' ? <Badge tone="green"><Check className="size-3" />Current</Badge> : <Button size="sm" variant="outline">Choose</Button>}</div>
          </li>
        ))}
      </ul>
      <Card className="mb-4">
        <CardTitle>WhatsApp spend this month (estimate)</CardTitle>
        <p className="mt-1 text-2xl font-bold">{inr(126012)}</p>
        <p className="text-xs text-muted-foreground">Charged by Meta to your card. LeadBotCloud adds nothing to this.</p>
      </Card>
      <Card>
        <CardTitle>Invoices</CardTitle>
        <ul className="mt-2 divide-y divide-border text-sm">
          {['1 Nov 2026', '1 Oct 2026'].map((d) => (
            <li key={d} className="flex min-h-11 items-center justify-between"><span>{d} · {inr(153282)} with GST</span><button className="font-semibold text-primary">Download</button></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

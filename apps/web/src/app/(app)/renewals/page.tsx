'use client';

import { useState } from 'react';
import { Copy, Phone, Send } from 'lucide-react';
import { renewals } from '@/lib/demo-data';
import { inr } from '@/lib/format';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';

const st: Record<string, [string, Tone]> = {
  due_soon: ['Due soon', 'amber'],
  overdue: ['Overdue', 'red'],
  renewed: ['Renewed', 'green'],
  cancelled: ['Cancelled', 'grey'],
};

export default function RenewalsPage() {
  const [tab, setTab] = useState('all');
  const rows = renewals.filter((r) => tab === 'all' || r.status === tab);
  const recovered = 49900;
  return (
    <div>
      <PageHeader title="Renewals" subtitle="We remind your customers and mark them renewed when they pay." />
      <DemoBanner />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card className="col-span-2 bg-primary text-primary-foreground">
          <CardTitle className="text-primary-foreground/80">Money recovered by LeadBotCloud this month</CardTitle>
          <p className="mt-1 text-3xl font-bold">{inr(recovered)}</p>
          <p className="text-xs text-primary-foreground/80">Reminder cost this month: ₹212. Recovered is about 2 times what you spent.</p>
        </Card>
        <Card><CardTitle>Due this month</CardTitle><p className="mt-1 text-2xl font-bold">6</p></Card>
        <Card><CardTitle>Renewal rate</CardTitle><p className="mt-1 text-2xl font-bold">68%</p></Card>
      </div>
      <div className="mb-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All' }, { id: 'due_soon', label: 'Due soon' }, { id: 'overdue', label: 'Overdue' }, { id: 'renewed', label: 'Renewed' }]} />
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const [label, tone] = st[r.status]!;
          return (
            <li key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold">{r.customer}</p><p className="text-sm text-muted-foreground">{r.plan} · {inr(r.amountPaise)}</p></div>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <p className="mt-2 text-sm">Ends {r.expiry}</p>
              <p className="text-xs text-muted-foreground">{r.next}</p>
              {r.status === 'overdue' ? (
                <Button variant="outline" size="sm" className="mt-3"><Phone className="size-4" />Call this customer</Button>
              ) : r.status !== 'renewed' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm"><Send className="size-4" />Send reminder now</Button>
                  <Button size="sm" variant="outline"><Copy className="size-4" />Copy payment link</Button>
                  <Button size="sm" variant="ghost">Mark as paid</Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Card className="mt-4">
        <CardTitle>Reminder schedule</CardTitle>
        <p className="mt-2 text-sm">7 days before · 3 days before · on the day · 2 days after</p>
        <p className="mt-1 text-xs text-muted-foreground">Reminders are promotional messages, so each one has a small WhatsApp cost. The payment link is made for each customer.</p>
      </Card>
    </div>
  );
}

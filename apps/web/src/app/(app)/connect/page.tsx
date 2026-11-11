'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';

const need = [
  'A phone number that can get an SMS or a call',
  'A Facebook account',
  'A debit or credit card for WhatsApp charges (billed by Meta, not by us)',
  'Your business name as it should appear to customers',
];

export default function ConnectPage() {
  const [path, setPath] = useState<'new' | 'keep'>('new');
  const [ack, setAck] = useState(false);
  return (
    <div>
      <PageHeader title="Connect WhatsApp" subtitle="About 5 minutes. You can stop and continue later." back={{ href: '/home', label: 'Home' }} />
      <DemoBanner />
      <Card className="mb-4">
        <p className="mb-2 font-semibold">What you will need</p>
        <ul className="flex flex-col gap-2 text-sm">{need.map((n) => <li key={n} className="flex gap-2"><Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{n}</li>)}</ul>
      </Card>
      <fieldset className="mb-4 flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Which number will you use?</legend>
        {([
          ['new', 'A new number for WhatsApp Business', 'Best for sending to many customers. The number cannot already be on the WhatsApp app.'],
          ['keep', 'Keep using my WhatsApp Business app number', 'You keep the app and use this panel together.'],
        ] as const).map(([id, t, d]) => (
          <label key={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <input type="radio" name="path" checked={path === id} onChange={() => setPath(id)} className="mt-1 size-5" />
            <span><span className="block font-semibold">{t}</span><span className="text-sm text-muted-foreground">{d}</span></span>
          </label>
        ))}
      </fieldset>
      {path === 'keep' ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="mb-1 font-semibold">Please read before you continue</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>You can send up to 20 messages a second.</li>
            <li>WhatsApp groups do not show up here.</li>
            <li>Only your last 6 months of chats are copied.</li>
            <li>Broadcast lists on the app become read-only.</li>
          </ul>
          <label className="mt-3 flex min-h-11 items-center gap-2 font-medium"><input type="checkbox" className="size-5" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand</label>
        </Card>
      ) : null}
      <Button className="w-full" disabled={path === 'keep' && !ack}><ExternalLink className="size-4" />Connect with Facebook</Button>

      <Card className="mt-6">
        <p className="mb-3 font-semibold">Ready to send checklist</p>
        <ul className="flex flex-col gap-2.5 text-sm">
          {[
            ['Number connected', true],
            ['Business name approved', true],
            ['Payment method added in WhatsApp Manager', false],
            ['Billing in Indian rupees', false],
            ['Messages arriving here', true],
            ['At least one approved message format', true],
          ].map(([t, ok]) => (
            <li key={t as string} className="flex items-center gap-2">
              {ok ? <CheckCircle2 className="size-5 text-primary" /> : <Circle className="size-5 text-muted-foreground" />}
              <span className="flex-1">{t as string}</span>
              {!ok ? <Badge tone="amber">To do</Badge> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

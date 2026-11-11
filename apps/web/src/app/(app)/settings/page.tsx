'use client';

import { useState } from 'react';
import { Field, Input, Select } from '@/components/ui/form';
import { Card, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';

const team = [
  { name: 'You', role: 'Owner' },
  { name: 'Priya Nair', role: 'Agent' },
  { name: 'Arjun Mehta', role: 'Admin' },
];

export default function SettingsPage() {
  const [cap, setCap] = useState(true);
  const [freq, setFreq] = useState(true);
  const [hours, setHours] = useState(true);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />
      <DemoBanner />
      <Card className="flex flex-col gap-3">
        <CardTitle>Business</CardTitle>
        <Field label="Business name"><Input defaultValue="DiGiXO Store" /></Field>
        <Field label="About (shown on WhatsApp)"><Input defaultValue="Digital subscriptions at fair prices" /></Field>
        <Field label="Language"><Select defaultValue="en"><option value="en">English</option><option value="hi">Hindi</option></Select></Field>
        <Button className="self-start">Save</Button>
      </Card>
      <Card className="flex flex-col">
        <CardTitle>Protection and limits</CardTitle>
        {[
          ['Stop promotional messages to anyone who got 2 this week', freq, setFreq],
          ['Warn me at 50%, 80% and 100% of my monthly spend limit', cap, setCap],
          ['Send an away message outside business hours (10 am to 7 pm)', hours, setHours],
        ].map(([label, val, set]) => (
          <div key={label as string} className="flex min-h-14 items-center justify-between gap-3 border-b border-border py-1 last:border-0">
            <span className="text-sm">{label as string}</span>
            <Switch checked={val as boolean} onChange={set as (v: boolean) => void} label={label as string} />
          </div>
        ))}
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between"><CardTitle>Team</CardTitle><Button size="sm" variant="outline">Invite</Button></div>
        <ul className="divide-y divide-border">
          {team.map((m) => (
            <li key={m.name} className="flex min-h-12 items-center justify-between text-sm"><span>{m.name}</span><Badge tone={m.role === 'Owner' ? 'green' : 'blue'}>{m.role}</Badge></li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Agents can chat. Admins can also send to customers and change settings. Only the owner sees billing.</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <CardTitle>Quick replies</CardTitle>
        <p className="text-sm text-muted-foreground">Type / in a chat to use these.</p>
        {['/price', '/upi', '/thanks'].map((q) => <Badge key={q} tone="grey" className="self-start">{q}</Badge>)}
      </Card>
      <Card className="flex flex-col gap-2">
        <CardTitle>Your data</CardTitle>
        <Button variant="outline" className="self-start">Export all my data</Button>
      </Card>
    </div>
  );
}

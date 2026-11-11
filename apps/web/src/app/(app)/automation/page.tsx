'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';

interface Rule { id: string; kw: string[]; reply: string; on: boolean }

const initial: Rule[] = [
  { id: 'a', kw: ['price', 'rate', 'kitna'], reply: 'Premium is ₹499 a month. Yearly is ₹4,999. Reply YEARLY for details.', on: true },
  { id: 'b', kw: ['hours', 'timing', 'kab'], reply: 'We are open 10 am to 7 pm, Monday to Saturday.', on: true },
  { id: 'c', kw: ['human', 'agent', 'call'], reply: 'Sure, a team member will reply soon.', on: false },
];

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[]>(initial);
  const [welcome, setWelcome] = useState(true);
  const [away, setAway] = useState(true);
  const [test, setTest] = useState('kitna hai premium');

  const hit = useMemo(() => {
    const t = test.toLowerCase();
    return rules.find((r) => r.on && r.kw.some((k) => t.includes(k)));
  }, [rules, test]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Auto-replies" subtitle="Answer common questions on your own. Customers can always reach a person." action={<Button size="sm"><Plus className="size-4" />New</Button>} />
      <DemoBanner />
      <Card className="flex flex-col">
        {[
          ['Welcome message', 'Sent the first time someone messages you', welcome, setWelcome],
          ['Away message', 'Sent outside business hours', away, setAway],
        ].map(([t, d, v, s]) => (
          <div key={t as string} className="flex min-h-16 items-center justify-between gap-3 border-b border-border py-1 last:border-0">
            <span><span className="block font-semibold">{t as string}</span><span className="text-sm text-muted-foreground">{d as string}</span></span>
            <Switch checked={v as boolean} onChange={s as (v: boolean) => void} label={t as string} />
          </div>
        ))}
      </Card>
      <p className="font-semibold">Keyword replies</p>
      <ul className="flex flex-col gap-3">
        {rules.map((r) => (
          <li key={r.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">When a message has: {r.kw.join(', ')}</p>
              <Switch checked={r.on} onChange={(v) => setRules(rules.map((x) => (x.id === r.id ? { ...x, on: v } : x)))} label={`Rule ${r.kw[0]}`} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{r.reply}</p>
          </li>
        ))}
      </ul>
      <Card className="flex flex-col gap-3">
        <CardTitle>Try it</CardTitle>
        <Field label="Type a customer message"><Input value={test} onChange={(e) => setTest(e.target.value)} /></Field>
        <p className="rounded-lg bg-muted p-3 text-sm">{hit ? <>Reply: <strong>{hit.reply}</strong></> : 'No rule matches, so nobody replies automatically.'}</p>
      </Card>
      <p className="text-xs text-muted-foreground">STOP and START are handled automatically to respect your customers&apos; choice. Auto-replies only work while the customer&apos;s 24-hour window is open.</p>
    </div>
  );
}

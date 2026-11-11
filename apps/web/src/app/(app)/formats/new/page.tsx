'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Sparkles, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { lintFormat, variablesOf } from '@/lib/format-lint';
import { estimateCost, type Category } from '@/lib/cost';
import { inr } from '@/lib/format';

const cats: { id: Category; label: string; hint: string }[] = [
  { id: 'marketing', label: 'Promotional', hint: 'Offers, festivals, renewal reminders' },
  { id: 'utility', label: 'Updates', hint: 'Orders, payment received, bookings' },
  { id: 'authentication', label: 'OTP', hint: 'Login codes only' },
];
const libraryStarters = [
  { name: 'diwali_offer', category: 'marketing' as Category, body: 'Hi {{1}}, our Diwali sale is on with 20% off all plans till Sunday. Reply YES to know more.' },
  { name: 'renewal_7_days', category: 'marketing' as Category, body: 'Hi {{1}}, your {{2}} plan ends on {{3}}. Renew now with this link: {{4}}' },
  { name: 'payment_received', category: 'utility' as Category, body: 'Payment received. Thank you {{1}}! Your plan is renewed till {{2}}.' },
];

export default function NewFormatPage() {
  const [name, setName] = useState('diwali_offer_2026');
  const [category, setCategory] = useState<Category>('marketing');
  const [body, setBody] = useState('Hi {{1}}, our Diwali sale is on with 20% off all plans till Sunday. Reply YES to know more.');
  const [samples, setSamples] = useState<Record<string, string>>({ '1': 'Asha' });

  const vars = useMemo(() => variablesOf(body), [body]);
  const lint = useMemo(() => lintFormat({ name, category, body, samples }), [name, category, body, samples]);
  const cost = estimateCost(1, lint.predictedCategory);
  const preview = body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, v: string) => samples[v] || `{{${v}}}`);
  const blocked = lint.issues.some((i) => i.level === 'error');
  const riskTone = lint.risk === 'low' ? 'green' : lint.risk === 'medium' ? 'amber' : 'red';
  const riskText = lint.risk === 'low' ? 'Low risk' : lint.risk === 'medium' ? 'Medium risk' : 'High risk';

  return (
    <div>
      <PageHeader title="New message format" subtitle="Write it, check it, then send it to WhatsApp for approval." back={{ href: '/formats', label: 'Message formats' }} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />Start from a ready-made message</p>
            <div className="flex flex-wrap gap-2">
              {libraryStarters.map((s) => (
                <Button key={s.name} variant="outline" size="sm" onClick={() => { setName(s.name); setCategory(s.category); setBody(s.body); setSamples({ '1': 'Asha', '2': 'Premium', '3': '14 Nov', '4': 'https://pay.example.com/abc' }); }}>
                  {s.name}
                </Button>
              ))}
            </div>
          </Card>
          <Card className="flex flex-col gap-4">
            <Field label="Name" hint="Small letters, numbers and underscores only."><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Type of message</legend>
              {cats.map((c) => (
                <label key={c.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" name="cat" checked={category === c.id} onChange={() => setCategory(c.id)} className="mt-0.5 size-5" />
                  <span><span className="block font-semibold">{c.label}</span><span className="text-muted-foreground">{c.hint}</span></span>
                </label>
              ))}
            </fieldset>
            <Field label="Language"><Select defaultValue="en"><option value="en">English</option><option value="hi">Hindi</option></Select></Field>
            <Field label="Message" hint="Use {{1}}, {{2}} for things that change, like the customer's name.">
              <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
              <span className="text-right text-xs text-muted-foreground">{body.length} / 1,024</span>
            </Field>
            {vars.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">An example for each changing part</p>
                {vars.map((v) => (
                  <Field key={v} label={`Example for {{${v}}}`}><Input value={samples[v] ?? ''} onChange={(e) => setSamples({ ...samples, [v]: e.target.value })} /></Field>
                ))}
              </div>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="bg-muted/60">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">How customers will see it</p>
            <div className="max-w-xs rounded-2xl rounded-bl-sm bg-card p-3 text-sm shadow-sm">
              <p className="whitespace-pre-wrap">{preview || 'Your message appears here'}</p>
              <p className="mt-1 text-right text-[10px] text-muted-foreground">10:42</p>
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Check before sending</p>
              <Badge tone={riskTone}>{riskText}</Badge>
            </div>
            <ul className="flex flex-col gap-2">
              {lint.issues.length === 0 ? <li className="flex gap-2 text-sm"><CheckCircle2 className="size-4 shrink-0 text-primary" />No problems found.</li> : null}
              {lint.issues.map((i, n) => (
                <li key={n} className="flex gap-2 text-sm">
                  {i.level === 'error' ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" /> : i.level === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> : <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
                  <span><span className="block font-medium">{i.text}</span><span className="text-muted-foreground">{i.fix}</span></span>
                </li>
              ))}
            </ul>
            <p className="rounded-lg bg-muted p-3 text-sm">
              WhatsApp will likely treat this as <strong>{cats.find((c) => c.id === lint.predictedCategory)?.label}</strong>. Estimated cost: <strong>{inr(cost.subtotalPaise, { decimals: true })}</strong> per message, plus 18% GST. Charged by Meta to your card.
            </p>
          </Card>
          <Button disabled={blocked}>Send to WhatsApp for approval</Button>
          {blocked ? <p className="text-center text-xs text-muted-foreground">Fix the red items above to continue.</p> : <p className="text-center text-xs text-muted-foreground">Approval usually takes a few minutes, sometimes up to a day.</p>}
        </div>
      </div>
    </div>
  );
}

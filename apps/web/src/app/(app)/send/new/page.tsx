'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { formats } from '@/lib/demo-data';
import { estimateCost } from '@/lib/cost';
import { inr, num } from '@/lib/format';
import { categoryLabel } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';
import { cn } from '@/lib/utils';

const approved = formats.filter((f) => f.status === 'approved');
const audiences = [
  { id: 'all', label: 'All customers who agreed', total: 1500, optedOut: 38, noConsent: 61, hold: 12, recent: 80 },
  { id: 'premium', label: 'Tag: Premium', total: 420, optedOut: 4, noConsent: 0, hold: 2, recent: 31 },
  { id: 'due', label: 'Renewal due this week', total: 220, optedOut: 1, noConsent: 0, hold: 3, recent: 0 },
];
const steps = ['Message', 'Customers', 'Check', 'Send'];

export default function NewSendPage() {
  const [step, setStep] = useState(0);
  const [fmtId, setFmtId] = useState(approved[0]!.id);
  const [aud, setAud] = useState(audiences[0]!.id);
  const [skipRecent, setSkipRecent] = useState(true);
  const [cap, setCap] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('later');
  const [done, setDone] = useState(false);

  const fmt = approved.find((f) => f.id === fmtId)!;
  const a = audiences.find((x) => x.id === aud)!;
  const sendable = a.total - a.optedOut - a.noConsent - a.hold - (skipRecent ? a.recent : 0);
  const cost = useMemo(() => estimateCost(sendable, fmt.category), [sendable, fmt.category]);
  const limit = 1000; // demo daily sending limit
  const overLimit = sendable > limit;
  const capPaise = cap ? Math.round(Number(cap) * 100) : 0;
  const overCap = capPaise > 0 && cost.totalPaise > capPaise;
  const blocked = sendable <= 0;

  if (done) {
    return (
      <Card className="mx-auto mt-8 flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <CheckCircle2 className="size-12 text-primary" />
        <h1 className="text-xl font-bold">{when === 'now' ? 'Sending has started' : 'Your send is scheduled'}</h1>
        <p className="text-sm text-muted-foreground">{num(sendable)} customers will get &quot;{fmt.name}&quot;. You can pause or cancel from the Send page.</p>
        <Button asChild><a href="/send">See results</a></Button>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader title="New send" back={{ href: '/send', label: 'Send to customers' }} />
      <DemoBanner />
      <ol className="mb-4 grid grid-cols-4 gap-1.5 text-center text-[11px] font-semibold" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className={cn('rounded-full px-1 py-2', i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>{i + 1}. {s}</li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Pick a message that WhatsApp has approved.</p>
          {approved.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="fmt" checked={fmtId === f.id} onChange={() => setFmtId(f.id)} className="mt-1 size-5" />
              <span className="flex-1">
                <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{f.name}</span><Badge>{categoryLabel[f.category]}</Badge></span>
                <span className="mt-1 block text-sm text-muted-foreground">{f.body}</span>
              </span>
            </label>
          ))}
          <Button onClick={() => setStep(1)}>Next: pick customers</Button>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Who should get it? Customers who stopped messages are always left out.</p>
          {audiences.map((x) => (
            <label key={x.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="aud" checked={aud === x.id} onChange={() => setAud(x.id)} className="size-5" />
              <span className="flex-1 font-semibold">{x.label}</span>
              <span className="text-sm text-muted-foreground">{num(x.total)}</span>
            </label>
          ))}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(0)}>Back</Button><Button className="flex-1" onClick={() => setStep(2)}>Next: check and cost</Button></div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-primary" />Safety check</p>
            <ul className="flex flex-col gap-2.5 text-sm">
              <Row ok text={`${num(a.optedOut)} customers who stopped messages were left out`} />
              <Row ok={a.noConsent === 0} warn={a.noConsent > 0} text={`${num(a.noConsent)} customers without recorded permission were left out`} />
              <Row ok={a.hold === 0} warn={a.hold > 0} text={`${num(a.hold)} customers are on a 24-hour WhatsApp hold. We will try them later.`} />
              <li className="flex items-start gap-2">
                <span className="mt-0.5">{a.recent > 0 ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-primary" />}</span>
                <span className="flex-1">
                  {num(a.recent)} customers got a promotional message in the last 24 hours.
                  {a.recent > 0 ? (
                    <label className="mt-1 flex min-h-11 items-center gap-2 font-medium"><input type="checkbox" className="size-5" checked={skipRecent} onChange={(e) => setSkipRecent(e.target.checked)} />Skip them (recommended)</label>
                  ) : null}
                </span>
              </li>
              <Row ok text="Your number quality is Safe" />
              <Row ok text="This message format is approved" />
              <li className="flex items-start gap-2">
                <span className="mt-0.5">{overLimit ? <XCircle className="size-4 text-danger" /> : <CheckCircle2 className="size-4 text-primary" />}</span>
                <span>
                  Your daily sending limit is {num(limit)}. This send is {num(sendable)}.
                  {overLimit ? <span className="mt-1 block font-medium text-danger">That is over your limit. Send in parts over {Math.ceil(sendable / limit)} days (we can split it for you).</span> : null}
                </span>
              </li>
            </ul>
          </Card>

          <Card className="flex flex-col gap-2">
            <p className="font-semibold">Estimated cost</p>
            <p className="text-sm">
              {num(cost.count)} × {inr(cost.ratePaise, { decimals: true })} = {inr(cost.subtotalPaise, { decimals: true })} + 18% GST {inr(cost.gstPaise, { decimals: true })}
            </p>
            <p className="text-3xl font-bold">{inr(cost.totalPaise)}</p>
            <p className="text-xs text-muted-foreground">This is an estimate. Charged by Meta to your card. LeadBotCloud adds nothing.</p>
          </Card>

          <Card className="flex flex-col gap-3">
            <Field label="Stop sending if the cost passes (optional)" hint="Rupees including GST. We pause the send at this amount."><Input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} placeholder="For example 1500" /></Field>
            {overCap ? <p className="text-sm font-medium text-warning">The estimate is above your cap. Sending will pause when the cap is reached.</p> : null}
            <p className="text-sm text-muted-foreground">Best time to send: 10–11 am or 6–8 pm. We avoid 9 pm to 9 am.</p>
          </Card>

          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button className="flex-1" disabled={blocked || overLimit} onClick={() => setStep(3)}>Next: send or schedule</Button></div>
          {overLimit ? <p className="text-center text-xs text-muted-foreground">Choose a smaller group to continue.</p> : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <p className="font-semibold">Final check</p>
            <p className="text-sm">Message: <strong>{fmt.name}</strong></p>
            <p className="text-sm">Customers: <strong>{num(sendable)}</strong></p>
            <p className="text-sm">Estimated cost: <strong>{inr(cost.totalPaise)}</strong> including GST</p>
          </Card>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="When to send">
            {(['now', 'later'] as const).map((w) => (
              <button key={w} role="radio" aria-checked={when === w} onClick={() => setWhen(w)} className={cn('min-h-11 rounded-xl border px-3 text-sm font-semibold', when === w ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card')}>{w === 'now' ? 'Send now' : 'Schedule'}</button>
            ))}
          </div>
          {when === 'later' ? <Field label="Date and time (IST)"><Input type="datetime-local" defaultValue="2026-11-15T10:30" /></Field> : null}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button className="flex-1" onClick={() => setDone(true)}>{when === 'now' ? `Send to ${num(sendable)} customers` : 'Schedule send'}</Button></div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ ok, warn, text }: { ok?: boolean; warn?: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5">{warn ? <AlertTriangle className="size-4 text-warning" /> : ok ? <CheckCircle2 className="size-4 text-primary" /> : null}</span>
      <span>{text}</span>
    </li>
  );
}

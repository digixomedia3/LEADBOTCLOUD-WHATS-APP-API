import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';

const factors = [
  { ok: true, text: 'WhatsApp rates your number Safe' },
  { ok: true, text: 'Only 1.4% of customers stopped messages after your last send' },
  { ok: false, text: '3 customers got more than 2 promotional messages this week. We now skip them.' },
  { ok: true, text: 'All your message formats are in good standing' },
];

export default function HealthPage() {
  return (
    <div>
      <PageHeader title="Number health" subtitle="How safe it is to keep sending from your WhatsApp number." />
      <DemoBanner />
      <Card className="mb-4 flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-6xl font-bold text-primary">86</p>
        <p className="text-sm text-muted-foreground">out of 100</p>
        <Badge tone="green">🟢 Safe to send</Badge>
      </Card>
      <Card className="mb-4 flex flex-col gap-3">
        <CardTitle>Daily sending limit</CardTitle>
        <Progress value={42} label="Daily sending limit used" />
        <p className="text-sm">420 of 1,000 customers messaged in the last 24 hours.</p>
        <p className="text-xs text-muted-foreground">WhatsApp raises your limit when your messages are well received.</p>
      </Card>
      <Card className="mb-4">
        <CardTitle>What affects your score</CardTitle>
        <ul className="mt-3 flex flex-col gap-3">
          {factors.map((f) => (
            <li key={f.text} className="flex gap-2 text-sm">
              {f.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              {f.text}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle>Protection that is always on</CardTitle>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
          <li>Sending pauses by itself if your number turns red.</li>
          <li>No customer gets more than 2 promotional messages a week.</li>
          <li>Customers who stopped messages are never included.</li>
          <li>Customers WhatsApp limited for 24 hours are tried again later.</li>
        </ul>
      </Card>
    </div>
  );
}

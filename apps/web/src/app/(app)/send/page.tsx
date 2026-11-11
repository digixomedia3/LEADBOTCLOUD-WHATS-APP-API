import Link from 'next/link';
import { Plus } from 'lucide-react';
import { campaigns } from '@/lib/demo-data';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';
import { inr, num, pct } from '@/lib/format';

const status: Record<string, [string, Tone]> = {
  running: ['Sending now', 'blue'],
  completed: ['Finished', 'green'],
  scheduled: ['Scheduled', 'amber'],
  paused: ['Paused', 'red'],
  draft: ['Draft', 'grey'],
};

export default function SendPage() {
  return (
    <div>
      <PageHeader
        title="Send to customers"
        subtitle="Send an approved message to many customers. You see the cost first."
        action={<Button asChild size="sm"><Link href="/send/new"><Plus className="size-4" />New</Link></Button>}
      />
      <DemoBanner />
      <ul className="flex flex-col gap-3">
        {campaigns.map((c) => {
          const [label, tone] = status[c.status]!;
          return (
            <li key={c.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.when}</p>
                </div>
                <Badge tone={tone}>{label}</Badge>
              </div>
              {c.status !== 'scheduled' ? (
                <>
                  <div className="mt-3"><Progress value={(c.sent / c.total) * 100} label={`${c.name} progress`} /></div>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[
                      ['Sent', c.sent],
                      ['Delivered', c.delivered],
                      ['Read', c.read],
                      ['Replied', c.replied],
                    ].map(([k, v]) => (
                      <div key={k as string} className="rounded-lg bg-muted p-2">
                        <dd className="text-lg font-bold">{num(v as number)}</dd>
                        <dt className="text-[11px] text-muted-foreground">{k} {k !== 'Sent' ? pct(v as number, c.sent) : ''}</dt>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {c.failed} did not go through · {c.limited} limited by WhatsApp (we will try again after 24 hours) · Cost so far {inr(c.costPaise)} plus GST, charged by Meta
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{num(c.total)} customers will get this message.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

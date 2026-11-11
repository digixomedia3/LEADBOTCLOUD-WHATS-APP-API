import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formats, type FormatStatus } from '@/lib/demo-data';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';
import { categoryLabel } from '@/lib/labels';

const statusLabel: Record<FormatStatus, [string, Tone]> = {
  approved: ['Approved', 'green'],
  review: ['In review', 'amber'],
  rejected: ['Not approved', 'red'],
  paused: ['Paused', 'red'],
};
const dot = { green: 'bg-green-500', yellow: 'bg-amber-500', red: 'bg-red-500', unknown: 'bg-slate-400' } as const;

export default function FormatsPage() {
  return (
    <div>
      <PageHeader
        title="Message formats"
        subtitle="WhatsApp must approve a message before you can send it to customers."
        action={<Button asChild size="sm"><Link href="/formats/new"><Plus className="size-4" />New</Link></Button>}
      />
      <DemoBanner />
      <ul className="flex flex-col gap-3">
        {formats.map((f) => {
          const [label, tone] = statusLabel[f.status];
          return (
            <li key={f.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{f.name}</p>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge>{categoryLabel[f.category]}</Badge>
                <span className="uppercase">{f.language}</span>
                <span className="inline-flex items-center gap-1"><span className={`size-2.5 rounded-full ${dot[f.quality]}`} aria-hidden />Quality {f.quality === 'unknown' ? 'not rated yet' : f.quality === 'green' ? 'good' : f.quality === 'yellow' ? 'medium' : 'low'}</span>
                <span>Sent {f.used.toLocaleString('en-IN')} times</span>
              </div>
              {f.reason ? (
                <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
                  <p className="font-semibold">Why it was not approved</p>
                  <p>{f.reason}</p>
                  <Button asChild size="sm" variant="outline" className="mt-2"><Link href="/formats/new">Edit and send again</Link></Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

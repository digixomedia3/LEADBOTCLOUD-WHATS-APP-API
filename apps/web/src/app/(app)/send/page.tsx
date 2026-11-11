import Link from 'next/link';
import { Plus } from 'lucide-react';
import { campaigns } from '@/lib/demo-data';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pagination, Table, TableWrap, Td, Th } from '@/components/ui/table';
import { DemoBanner } from '@/components/demo-banner';
import { inr, num, pct } from '@/lib/format';

const status: Record<string, [string, Tone]> = {
  running: ['LIVE', 'green'],
  completed: ['Completed', 'grey'],
  scheduled: ['Scheduled', 'amber'],
  paused: ['Paused', 'red'],
  draft: ['Draft', 'grey'],
};
const template: Record<string, string> = { b1: 'diwali_offer_2026', b2: 'renewal_reminder_7d', b3: 'new_plan_launch' };

export default function CampaignsPage() {
  return (
    <div className="flex flex-col gap-4">
      <DemoBanner />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Send an approved template to many contacts. You see the cost before you send.</p>
        <Button asChild><Link href="/send/new"><Plus className="size-4" />Create Campaign</Link></Button>
      </div>
      <TableWrap>
        <Table>
          <thead>
            <tr><Th>Campaign</Th><Th>Template</Th><Th>Status</Th><Th>When</Th><Th className="text-right">Audience</Th><Th className="text-right">Sent</Th><Th className="text-right">Delivered</Th><Th className="text-right">Read</Th><Th className="text-right">Replied</Th><Th className="text-right">Failed</Th><Th className="text-right">Cost</Th></tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const [label, tone] = status[c.status]!;
              return (
                <tr key={c.id} className="group hover:bg-muted/40">
                  <Td className="font-semibold"><Link href={`/send/${c.id}`} className="hover:underline">{c.name}</Link></Td>
                  <Td className="font-mono text-xs">{template[c.id]}</Td>
                  <Td><Badge tone={tone}>{label}</Badge></Td>
                  <Td className="text-muted-foreground">{c.when}</Td>
                  <Td className="text-right">{num(c.total)}</Td>
                  <Td className="text-right">{num(c.sent)}</Td>
                  <Td className="text-right">{num(c.delivered)} <span className="text-xs text-muted-foreground">{pct(c.delivered, c.sent)}</span></Td>
                  <Td className="text-right">{num(c.read)} <span className="text-xs text-muted-foreground">{pct(c.read, c.sent)}</span></Td>
                  <Td className="text-right">{num(c.replied)}</Td>
                  <Td className="text-right">{num(c.failed)}</Td>
                  <Td className="text-right">{inr(c.costPaise)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <Pagination from={1} to={campaigns.length} total={campaigns.length} />
      </TableWrap>
    </div>
  );
}

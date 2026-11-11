'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { formats, type FormatStatus } from '@/lib/demo-data';
import { categoryLabel } from '@/lib/labels';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { DemoBanner } from '@/components/demo-banner';

const statusLabel: Record<FormatStatus, [string, Tone]> = {
  approved: ['Approved', 'green'],
  review: ['Pending', 'amber'],
  rejected: ['Rejected', 'red'],
  paused: ['Paused', 'red'],
};
const dot = { green: 'bg-green-500', yellow: 'bg-amber-500', red: 'bg-red-500', unknown: 'bg-slate-400' } as const;

export default function TemplatesPage() {
  const [tab, setTab] = useState('all');
  const rows = formats.filter((f) => tab === 'all' || f.status === tab);
  const count = (s: FormatStatus) => formats.filter((f) => f.status === s).length;
  return (
    <div className="flex flex-col gap-4">
      <DemoBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'all', label: 'All', count: formats.length },
            { id: 'approved', label: 'Approved', count: count('approved') },
            { id: 'review', label: 'Pending', count: count('review') },
            { id: 'rejected', label: 'Rejected', count: count('rejected') },
          ]}
        />
        <Button asChild><Link href="/formats/new"><Plus className="size-4" />New Template</Link></Button>
      </div>
      <TableWrap>
        <Table>
          <thead>
            <tr><Th>Template name</Th><Th>Category</Th><Th>Language</Th><Th>Status</Th><Th>Quality</Th><Th className="text-right">Sent</Th><Th>Message</Th></tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const [label, tone] = statusLabel[f.status];
              return (
                <tr key={f.id} className="group align-top hover:bg-muted/40">
                  <Td className="font-mono text-xs font-semibold">{f.name}</Td>
                  <Td><Badge>{categoryLabel[f.category]}</Badge></Td>
                  <Td className="uppercase text-muted-foreground">{f.language}</Td>
                  <Td>
                    <Badge tone={tone}>{label}</Badge>
                    {f.reason ? <p className="mt-1 max-w-56 whitespace-normal text-xs text-danger">{f.reason}</p> : null}
                  </Td>
                  <Td><span className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-full ${dot[f.quality]}`} aria-hidden />{f.quality === 'unknown' ? 'Not rated' : f.quality === 'green' ? 'High' : f.quality === 'yellow' ? 'Medium' : 'Low'}</span></Td>
                  <Td className="text-right">{f.used.toLocaleString('en-IN')}</Td>
                  <Td className="max-w-md whitespace-normal text-muted-foreground">{f.body}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  );
}

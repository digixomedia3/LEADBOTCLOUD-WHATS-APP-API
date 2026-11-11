'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, CheckCheck, Pause, RefreshCw, Reply, TriangleAlert } from 'lucide-react';
import type { Campaign } from '@/lib/demo-data';
import { inr, num, pct } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { Stat } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const recipients = [
  { n: 'Asha Verma', p: '+91 00000 11101', s: 'read', t: '6:31 pm' },
  { n: 'Rohit Singh', p: '+91 00000 11102', s: 'delivered', t: '6:31 pm' },
  { n: 'Deepak Joshi', p: '+91 00000 11106', s: 'replied', t: '6:32 pm' },
  { n: 'Vikram Patel', p: '+91 00000 11108', s: 'sent', t: '6:32 pm' },
  { n: 'Neha Gupta', p: '+91 00000 11103', s: 'failed', t: '6:32 pm', err: 'WhatsApp limited offers to this customer today. We will try again after 24 hours.' },
] as const;

const tabDefs = [
  { id: 'overview', label: 'Overview', Icon: RefreshCw },
  { id: 'sent', label: 'Sent', Icon: Check },
  { id: 'delivered', label: 'Delivered', Icon: CheckCheck },
  { id: 'read', label: 'Read', Icon: CheckCheck },
  { id: 'replied', label: 'Replied', Icon: Reply },
  { id: 'failed', label: 'Failed', Icon: TriangleAlert },
] as const;

export function CampaignDetail({ c }: { c: Campaign }) {
  const [tab, setTab] = useState<(typeof tabDefs)[number]['id']>('overview');
  const [state, setState] = useState(c.status);
  const val: Record<string, number> = { sent: c.sent, delivered: c.delivered, read: c.read, replied: c.replied, failed: c.failed };
  const rows = recipients.filter((r) => tab === 'overview' || r.s === tab || (tab === 'sent' && ['sent', 'delivered', 'read', 'replied'].includes(r.s)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/send" aria-label="Back to campaigns" className="flex size-10 items-center justify-center rounded-full hover:bg-muted"><ArrowLeft className="size-5" /></Link>
        <h2 className="text-xl font-bold">{c.name}</h2>
        <Badge tone={state === 'running' ? 'green' : state === 'paused' ? 'red' : 'grey'}>{state === 'running' ? 'LIVE' : state === 'paused' ? 'Paused' : state === 'scheduled' ? 'Scheduled' : 'Completed'}</Badge>
        {state === 'running' ? <Button variant="outline" size="sm" onClick={() => setState('paused')}><Pause className="size-4" />Pause</Button> : null}
        {state === 'paused' ? <Button size="sm" onClick={() => setState('running')}>Resume</Button> : null}
      </div>

      <div role="tablist" className="-mx-4 flex overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
        {tabDefs.map(({ id, label, Icon }) => {
          const v = id === 'overview' ? 100 : Math.round(((val[id] ?? 0) / Math.max(c.total, 1)) * 100);
          const n = id === 'overview' ? c.total : val[id] ?? 0;
          return (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('flex min-h-14 shrink-0 flex-col items-center justify-center gap-0.5 border-b-2 px-5 text-sm', tab === id ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground')}>
              <span className="text-xs">{v}% ({num(n)})</span>
              <span className="flex items-center gap-1"><Icon className="size-4" />{label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-sm">
            {[['Campaign type', 'One-time'], ['Message type', 'TEMPLATE'], ['Category', 'Promotional'], ['Created at', c.when]].map(([k, v]) => (
              <div key={k}><p className="text-xs text-muted-foreground">{k}</p><p className="font-semibold">{v}</p></div>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Stat label="Status" value={state === 'running' ? 'LIVE' : state === 'paused' ? 'PAUSED' : 'DONE'} />
              <Stat label="Audience" value={num(c.total)} />
              <Stat label="Estimated cost" value={inr(c.costPaise)} sub="plus GST, charged by Meta" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(['sent', 'delivered', 'read', 'replied', 'failed'] as const).map((k) => (
                <Stat key={k} label={k[0]!.toUpperCase() + k.slice(1)} value={num(val[k] ?? 0)} sub={k === 'sent' ? undefined : pct(val[k] ?? 0, c.sent)} />
              ))}
            </div>
            <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              {num(c.limited)} customers were limited by WhatsApp today. We will try them again after 24 hours. These are not counted as failed.
            </p>
          </div>
        </div>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Status</Th><Th>Time</Th><Th>Reason</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.p}>
                  <Td className="font-semibold">{r.n}</Td><Td className="font-mono text-xs">{r.p}</Td>
                  <Td><Badge tone={r.s === 'failed' ? 'red' : r.s === 'read' || r.s === 'replied' ? 'blue' : 'green'}>{r.s}</Badge></Td>
                  <Td className="text-muted-foreground">{r.t}</Td>
                  <Td className="max-w-xs whitespace-normal text-muted-foreground">{'err' in r ? r.err : '-'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

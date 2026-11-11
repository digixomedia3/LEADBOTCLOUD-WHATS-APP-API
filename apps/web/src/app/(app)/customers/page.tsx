'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Search, Upload } from 'lucide-react';
import { customers } from '@/lib/demo-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { DemoBanner } from '@/components/demo-banner';
import { initials } from '@/components/chats/chat-list';

const consentTone = { allowed: 'green', stopped: 'red', unknown: 'amber' } as const;
const consentText = { allowed: 'Allowed messages', stopped: 'Stopped messages', unknown: 'Permission not recorded' } as const;

export default function CustomersPage() {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const rows = customers.filter((c) => {
    if (q && !`${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (tab === 'allowed') return c.consent === 'allowed';
    if (tab === 'stopped') return c.consent === 'stopped';
    if (tab === 'renewal') return !!c.renewal;
    return true;
  });
  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="People who agreed to get WhatsApp messages from you."
        action={
          <Button asChild size="sm">
            <Link href="/customers/import"><Upload className="size-4" />Import</Link>
          </Button>
        }
      />
      <DemoBanner />
      <div className="mb-3 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" placeholder="Search name or number" className="min-h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm" />
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'all', label: 'All', count: customers.length },
            { id: 'allowed', label: 'Allowed', count: customers.filter((c) => c.consent === 'allowed').length },
            { id: 'stopped', label: 'Stopped', count: customers.filter((c) => c.consent === 'stopped').length },
            { id: 'renewal', label: 'With renewals', count: customers.filter((c) => c.renewal).length },
          ]}
        />
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground">No customers match. Clear the search or pick All.</li> : null}
        {rows.map((c) => (
          <li key={c.id}>
            <Link href={`/customers/${c.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">{initials(c.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{c.phone}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <Badge tone={consentTone[c.consent]}>{consentText[c.consent]}</Badge>
                {c.renewal ? <span className="text-xs text-muted-foreground">{c.renewal}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Button asChild className="mt-4 w-full sm:w-auto" variant="outline">
        <Link href="/customers/import"><Plus className="size-4" />Add or import customers</Link>
      </Button>
    </div>
  );
}

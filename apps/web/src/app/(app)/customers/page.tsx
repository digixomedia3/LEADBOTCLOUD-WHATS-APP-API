'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronDown, Search, Upload, UserPlus } from 'lucide-react';
import { customers } from '@/lib/demo-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { Pagination, Table, TableWrap, Td, Th } from '@/components/ui/table';
import { DemoBanner } from '@/components/demo-banner';

const consentTone = { allowed: 'green', stopped: 'red', unknown: 'amber' } as const;
const consentText = { allowed: 'Opted in', stopped: 'Opted out', unknown: 'Not recorded' } as const;

export default function ContactsPage() {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);

  const rows = useMemo(
    () =>
      customers.filter((c) => {
        if (q && !`${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase())) return false;
        if (tab === 'allowed') return c.consent === 'allowed';
        if (tab === 'stopped') return c.consent === 'stopped';
        if (tab === 'renewal') return !!c.renewal;
        return true;
      }),
    [q, tab],
  );
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAll = () => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="flex flex-col gap-4">
      <DemoBanner />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" placeholder="Search name or number" className="min-h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm" />
        </div>
        <Button asChild variant="outline"><Link href="/customers/import"><Upload className="size-4" />Import</Link></Button>
        <Button variant="outline"><UserPlus className="size-4" />Add contact</Button>
        <div className="relative">
          <Button variant="outline" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>Actions<ChevronDown className="size-4" /></Button>
          {menu ? (
            <ul role="menu" className="absolute right-0 z-10 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-card py-1 text-sm shadow-lg">
              {['Add tag', 'Remove tag', 'Set attribute', 'Export selected', 'Delete'].map((a) => (
                <li key={a} role="none"><button role="menuitem" className="min-h-11 w-full px-4 text-left hover:bg-muted" onClick={() => setMenu(false)}>{a}</button></li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'all', label: 'All', count: customers.length },
          { id: 'allowed', label: 'Opted in', count: customers.filter((c) => c.consent === 'allowed').length },
          { id: 'stopped', label: 'Opted out', count: customers.filter((c) => c.consent === 'stopped').length },
          { id: 'renewal', label: 'With renewals', count: customers.filter((c) => c.renewal).length },
        ]}
      />
      {sel.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm">
          <span className="font-semibold">{sel.size} selected</span>
          <Button asChild size="sm"><Link href="/send/new">Create campaign for selected</Link></Button>
        </div>
      ) : null}
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th className="w-10"><input type="checkbox" aria-label="Select all" checked={allOn} onChange={toggleAll} className="size-4" /></Th>
              <Th>Name</Th><Th>Phone</Th><Th>Tags</Th><Th>Status</Th><Th>Source</Th><Th>Last message</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><Td colSpan={7} className="py-10 text-center text-muted-foreground">No contacts match. Clear the search or pick All.</Td></tr> : null}
            {rows.map((c) => (
              <tr key={c.id} className="group hover:bg-muted/40">
                <Td><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="size-4" /></Td>
                <Td className="font-semibold"><Link href={`/customers/${c.id}`} className="hover:underline">{c.name}</Link></Td>
                <Td className="font-mono text-xs">{c.phone}</Td>
                <Td><div className="flex gap-1">{c.tags.length ? c.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>) : <span className="text-muted-foreground">-</span>}</div></Td>
                <Td><Badge tone={consentTone[c.consent]}>{consentText[c.consent]}</Badge></Td>
                <Td className="text-muted-foreground">{c.source}</Td>
                <Td className="text-muted-foreground">{c.lastMessage}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination from={rows.length ? 1 : 0} to={rows.length} total={rows.length} />
      </TableWrap>
    </div>
  );
}

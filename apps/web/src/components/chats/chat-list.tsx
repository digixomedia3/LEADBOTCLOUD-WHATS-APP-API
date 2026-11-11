'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { chats } from '@/lib/demo-data';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Tabs } from '@/components/ui/tabs';

const filters = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Assigned to me' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'unread', label: 'Unread' },
];

export function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
}

export function ChatList() {
  const path = usePathname();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  const rows = chats.filter((c) => {
    if (q && !`${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'mine') return c.assignee === 'You';
    if (filter === 'unassigned') return c.assignee === null;
    if (filter === 'unread') return c.unread > 0;
    return true;
  });

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or number"
          aria-label="Search chats"
          className="min-h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm"
        />
      </div>
      <Tabs tabs={filters} value={filter} onChange={setFilter} />
      <ul className="flex flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">No chats match. Clear the search or pick All.</li>
        ) : null}
        {rows.map((c) => (
          <li key={c.id}>
            <Link
              href={`/chats/${c.id}`}
              className={cn('flex min-h-16 items-center gap-3 px-3 py-2', path === `/chats/${c.id}` && 'bg-muted')}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                {initials(c.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.time}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted-foreground">{c.last}</span>
                  {c.unread > 0 ? (
                    <Badge tone="green" aria-label={`${c.unread} unread`}>{c.unread}</Badge>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

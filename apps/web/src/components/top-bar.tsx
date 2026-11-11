'use client';

import { Bell, Search } from 'lucide-react';
import { numberStatus as s } from '@/lib/number-status';
import { cn } from '@/lib/utils';

const q = {
  high: ['High', 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'],
  medium: ['Medium', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
  low: ['Low', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'],
} as const;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Top bar: page title, global search, live number status, notifications. Scrolls sideways on phones. */
export function TopBar({ title }: { title: string }) {
  const [ql, qc] = q[s.quality];
  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-card px-4 py-2 md:px-6">
      <h1 className="shrink-0 text-base font-semibold md:text-lg">{title}</h1>
      <div className="relative hidden w-72 lg:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input aria-label="Search" placeholder="Search" className="h-9 w-full rounded-full border border-border bg-background pl-9 pr-3 text-sm" />
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-3 md:gap-5" aria-label="Number status">
        <Stat label="Quality"><span className={cn('rounded-full px-2.5 py-0.5 font-semibold', qc)}>{ql}</span></Stat>
        <span className="hidden md:contents">
          <Stat label="Messaging Tier"><span className="font-semibold">{s.tier}</span><span className="text-muted-foreground">({s.tierLimit})</span></Stat>
          <Stat label="Remaining Quota"><span className="font-semibold">{s.remainingQuota.toLocaleString('en-IN')}</span></Stat>
        </span>
        <Stat label="WABA"><span className="rounded-full bg-green-500 px-2.5 py-0.5 font-bold text-white">{s.wabaLive ? 'LIVE' : 'OFF'}</span></Stat>
      </div>
      <button aria-label="Notifications" className="relative flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-muted">
        <Bell className="size-5" />
        <span className="absolute right-2 top-2 size-2 rounded-full bg-danger" />
      </button>
    </header>
  );
}

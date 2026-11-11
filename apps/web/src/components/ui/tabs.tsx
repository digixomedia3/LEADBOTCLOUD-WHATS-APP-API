'use client';

import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium',
            value === t.id
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-muted-foreground',
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 opacity-80">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

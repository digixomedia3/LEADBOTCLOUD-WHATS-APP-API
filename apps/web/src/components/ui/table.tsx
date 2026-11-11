import * as React from 'react';
import { cn } from '@/lib/utils';

/** Data table in the style of the real panels: header row, checkbox column, hover rows. Scrolls sideways on phones. */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto rounded-xl border border-border bg-card', className)}>{children}</div>;
}
export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full min-w-[40rem] text-sm', className)} {...p} />;
}
export function Th({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn('whitespace-nowrap border-b border-border bg-muted/50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)} {...p} />;
}
export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('whitespace-nowrap border-b border-border px-4 py-3 group-last:border-b-0', className)} {...p} />;
}

export function Pagination({ from, to, total, perPage = 25 }: { from: number; to: number; total: number; perPage?: number }) {
  return (
    <div className="flex items-center justify-end gap-4 px-4 py-3 text-xs text-muted-foreground">
      <span>{perPage} per page</span>
      <span>{from}-{to} of {total}</span>
    </div>
  );
}

/** Small stat tile used on dashboards and campaign pages. */
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

import { cn } from '@/lib/utils';

export function Progress({
  value,
  tone = 'green',
  label,
}: {
  value: number;
  tone?: 'green' | 'amber' | 'red';
  label: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === 'green' ? 'bg-primary' : tone === 'amber' ? 'bg-warning' : 'bg-danger';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className={cn('h-full rounded-full', color)} style={{ width: `${v}%` }} />
    </div>
  );
}

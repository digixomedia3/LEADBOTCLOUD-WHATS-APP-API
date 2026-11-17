import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CampaignReportData } from '@/lib/core/campaign-report';
import type { MetricResult } from '@lbc/shared/ab-test';

const num = (n: number) => n.toLocaleString('en-IN');
const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1).replace(/\.0$/, '')}%`);

const VERDICT: Record<MetricResult['verdict'], { text: string; tone: string }> = {
  too_early: { text: 'Too early', tone: 'bg-ink/10 text-muted' },
  no_clear_difference: { text: 'No clear difference', tone: 'bg-ink/10' },
  a_better: { text: 'A is better', tone: 'bg-brand/15 text-brand' },
  b_better: { text: 'B is better', tone: 'bg-brand/15 text-brand' },
};

/** The two versions side by side. Only calls a winner when the gap is too big to be luck, and says so when it is not. */
export function AbTestCard({ ab }: { ab: NonNullable<CampaignReportData['abTest']> }) {
  const rows: { label: string; m: MetricResult; a: number; b: number; of: string }[] = [
    { label: 'Read it', m: ab.result.read, a: ab.a.counts.read, b: ab.b.counts.read, of: 'delivered' },
    { label: 'Replied', m: ab.result.reply, a: ab.a.counts.replied, b: ab.b.counts.replied, of: 'delivered' },
  ];
  return (
    <section className="card p-5" aria-label="A/B test">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold"><FlaskConical className="size-5 text-indigo" aria-hidden />Test result</h3>
      <p className="mt-1 text-sm font-semibold" role="status">{ab.headline}</p>
      <p className="mt-1 text-xs text-muted">{100 - ab.percentB}% of people got version A and {ab.percentB}% got version B, chosen at random. Each person is counted once.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {([['A', ab.a], ['B', ab.b]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-card2 p-3 text-sm">
            <p className="font-display text-base font-bold">Version {k}</p>
            <p className="break-words text-xs text-muted">{v.template ?? 'Deleted template'}</p>
            <dl className="mt-2 grid grid-cols-2 gap-y-1">
              <dt className="text-muted">Messaged</dt><dd className="text-right tabular-nums">{num(v.counts.received)}</dd>
              <dt className="text-muted">Delivered</dt><dd className="text-right tabular-nums">{num(v.counts.delivered)}</dd>
              <dt className="text-muted">Read</dt><dd className="text-right tabular-nums">{num(v.counts.read)} <span className="text-xs text-muted">({pct(v.counts.delivered ? v.counts.read / v.counts.delivered : null)})</span></dd>
              <dt className="text-muted">Replied</dt><dd className="text-right tabular-nums">{num(v.counts.replied)} <span className="text-xs text-muted">({pct(v.counts.delivered ? v.counts.replied / v.counts.delivered : null)})</span></dd>
            </dl>
          </div>))}
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-line text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>{r.label}: A {pct(r.m.rateA)} · B {pct(r.m.rateB)}{r.m.diffPoints !== null ? <span className="text-xs text-muted"> ({r.m.diffPoints > 0 ? '+' : ''}{r.m.diffPoints} points for B)</span> : null}</span>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', VERDICT[r.m.verdict].tone)}>{VERDICT[r.m.verdict].text}</span>
          </li>))}
      </ul>
      <p className="mt-2 text-xs text-muted">Rates are of delivered messages. A difference only counts once each version has at least {ab.minPerVersion} delivered messages and the gap is too large to be chance (about 95% sure). Reads and replies keep coming in for a day or two, so check again later before choosing.</p>
    </section>
  );
}

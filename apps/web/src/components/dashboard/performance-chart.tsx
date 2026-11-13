'use client';

import { useId, useState } from 'react';

export interface Point { label: string; sent: number; delivered: number; read: number }

/** Smooth three-series area chart with hover readout. Pure SVG, no chart library. */
export function PerformanceChart({ data }: { data: Point[] }) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 220, padL = 8, padR = 8, padT = 12, padB = 26;
  const max = Math.max(1, ...data.flatMap((d) => [d.sent, d.delivered, d.read])) * 1.1;
  const x = (i: number) => padL + (i / (data.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);

  const smooth = (key: 'sent' | 'delivered' | 'read') => {
    const p = data.map((d, i) => [x(i), y(d[key])] as const);
    let dstr = `M${p[0]![0]},${p[0]![1]}`;
    for (let i = 1; i < p.length; i++) {
      const [x0, y0] = p[i - 1]!; const [x1, y1] = p[i]!;
      const cx = (x0 + x1) / 2;
      dstr += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    return dstr;
  };
  const series = [
    { key: 'sent' as const, color: '#6366f1', name: 'Sent' },
    { key: 'delivered' as const, color: '#06b6d4', name: 'Delivered' },
    { key: 'read' as const, color: '#10b981', name: 'Read' },
  ];
  const hv = hover === null ? null : data[hover]!;

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs font-medium">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Messages sent, delivered and read over the last 14 days" onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={padL} x2={W - padR} y1={padT + t * (H - padT - padB)} y2={padT + t * (H - padT - padB)} stroke="var(--line)" strokeDasharray="3 5" />
        ))}
        {series.map((s, n) => (
          <g key={s.key}>
            <path d={`${smooth(s.key)} L${x(data.length - 1)},${H - padB} L${x(0)},${H - padB} Z`} fill={`url(#${gid}-${s.key})`} />
            <path d={smooth(s.key)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" style={{ strokeDasharray: 1400, ['--len' as string]: 1400, animation: `draw 1.6s ${n * 0.18}s ease-out both` }} />
          </g>
        ))}
        {data.map((d, i) => (
          <g key={d.label}>
            <rect x={x(i) - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
            {i % 2 === 0 ? <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label}</text> : null}
          </g>
        ))}
        {hover !== null ? (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--muted)" strokeDasharray="3 3" />
            {series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(data[hover]![s.key])} r="4.5" fill="var(--card)" stroke={s.color} strokeWidth="2.5" />)}
          </g>
        ) : null}
      </svg>
      <div className="mt-2 min-h-5 text-xs text-muted" aria-live="polite">
        {hv ? <span><strong className="text-ink">{hv.label}</strong> · Sent {hv.sent.toLocaleString('en-IN')} · Delivered {hv.delivered.toLocaleString('en-IN')} · Read {hv.read.toLocaleString('en-IN')}</span> : 'Hover or tap the chart for exact numbers.'}
      </div>
    </div>
  );
}

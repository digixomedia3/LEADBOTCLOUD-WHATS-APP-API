import { useId } from 'react';

/** Tiny trend line with a soft fill. Pure SVG, drawn in with CSS. */
export function Sparkline({ data, color = '#10b981', height = 40 }: { data: number[]; color?: string; height?: number }) {
  const id = useId();
  const w = 120;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((d, i) => [(i / (data.length - 1)) * w, height - 4 - ((d - min) / span) * (height - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ ['--len' as string]: 300, strokeDasharray: 300, animation: 'draw 1.4s ease-out forwards' }} />
    </svg>
  );
}

/** Circular gauge that fills in on load. */
export function Ring({ value, size = 132, stroke = 12, label, sub }: { value: number; size?: number; stroke?: number; label: string; sub: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`${label}: ${value} out of 100`}>
        <defs>
          <linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#10b981" /><stop offset="55%" stopColor="#06b6d4" /><stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ringgrad)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} style={{ ['--len' as string]: c, strokeDashoffset: off, animation: 'draw 1.6s cubic-bezier(0.2,0.8,0.2,1) both' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl font-extrabold tabular">{value}</span>
        <span className="text-[11px] text-white/70">{sub}</span>
      </div>
    </div>
  );
}

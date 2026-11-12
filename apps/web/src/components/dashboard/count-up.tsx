'use client';

import { useEffect, useRef, useState } from 'react';

const reduce = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts up once when it scrolls into view. Honors reduced motion. */
export function CountUp({ to, prefix = '', suffix = '', duration = 1100, format }: { to: number; prefix?: string; suffix?: string; duration?: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce()) { setV(to); return; }
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting || done.current) return;
      done.current = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        setV(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  const n = Math.round(v);
  return <span ref={ref} className="tabular">{prefix}{format ? format(n) : n.toLocaleString('en-IN')}{suffix}</span>;
}

'use client';

import { useEffect, useRef } from 'react';

/**
 * Pipeline network: four data streams run down the page margins like circuit traces and branch into each section's key
 * element, ending in the closing CTA. Each stream has one colour job, the same as the hero's:
 *   Leads (amber) and Chats (indigo) on the left, Cost (sky) and Sales (emerald) on the right.
 * Comets of light travel each hop. Hovering a section brightens the streams that touch it.
 *
 * Drawn only on wide screens (the margins are too thin below ~1180px). Hero markup is untouched: its anchors are found by
 * selector. Everything else is tagged `data-net="..."`. Reduced motion: lines and ports only, no comets.
 * Performance: only hops near the viewport animate; the rest are paused.
 */
type Side = 'left' | 'right';
type Anchor = [sel: string, at: number];
type Stream = { key: string; label: string; color: string; side: Side; lane: 0 | 1; anchors: Anchor[] };

const HERO_STATS = '#top > div > section:first-child > div:last-child';
const STREAMS: Stream[] = [
  { key: 'leads', label: 'Leads', color: '#F59E0B', side: 'left', lane: 0,
    anchors: [[HERO_STATS, 0.35], ['[data-net="proof"]', 0.3], ['[data-net="how-tabs"]', 0.5], ['[data-net="flows-list"]', 0.12], ['[data-net="safety"]', 0.3], ['[data-net="plans"]', 0.22], ['[data-net="cta"]', 0.3]] },
  { key: 'chats', label: 'Chats', color: '#6366F1', side: 'left', lane: 1,
    anchors: [[HERO_STATS, 0.75], ['[data-net="how-panel"]', 0.22], ['[data-net="flows-list"]', 0.62], ['[data-net="cost"]', 0.3], ['[data-net="cmp-app"]', 0.18], ['[data-net="faq-aside"]', 0.5], ['[data-net="cta"]', 0.7]] },
  { key: 'cost', label: 'Cost', color: '#0EA5E9', side: 'right', lane: 1,
    anchors: [['#motionStage', 0.5], ['[data-net="proof"]', 0.5], ['[data-net="how-tabs"]', 0.5], ['[data-net="cost"]', 0.45], ['[data-net="safety"]', 0.55], ['[data-net="plans"]', 0.3], ['[data-net="cta"]', 0.3]] },
  { key: 'sales', label: 'Sales', color: '#10B981', side: 'right', lane: 0,
    anchors: [['#motionStage', 0.82], ['[data-net="how-panel"]', 0.55], ['[data-net="flows-steps"]', 0.5], ['[data-net="cmp-lbc"]', 0.25], ['[data-net="faq-list"]', 0.15], ['[data-net="cta"]', 0.7]] },
];

const MIN_W = 1180;
const SPEED = 210; // px per second
const NS = 'http://www.w3.org/2000/svg';

/** Orthogonal polyline with rounded corners. */
function roundedPath(pts: [number, number][], r = 12) {
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!, [x, y] = pts[i]!, [nx, ny] = pts[i + 1]!;
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, l1 / 2, l2 / 2);
    if (k < 0.5) { d += ` L ${x} ${y}`; continue; }
    const ax = x - ((x - px) / l1) * k, ay = y - ((y - py) / l1) * k;
    const bx = x + ((nx - x) / l2) * k, by = y + ((ny - y) / l2) * k;
    d += ` L ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${x} ${y} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  const [lx, ly] = pts[pts.length - 1]!;
  return d + ` L ${lx} ${ly}`;
}

export function PipelineNetwork() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const host = svg?.parentElement;
    if (!svg || !host) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    type Hop = { el: SVGPathElement; glow: SVGPathElement; core: SVGPathElement; anims: Animation[]; top: number; bottom: number; secs: Element[] };
    let hops: Hop[] = [];
    let raf = 0;

    const mk = (tag: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      return e;
    };

    function cull() {
      const vt = window.scrollY - 400, vb = window.scrollY + window.innerHeight + 400;
      const hr = host!.getBoundingClientRect().top + window.scrollY;
      for (const h of hops) {
        const near = h.bottom + hr > vt && h.top + hr < vb;
        for (const a of h.anims) { if (near && a.playState !== 'running') a.play(); else if (!near && a.playState === 'running') a.pause(); }
      }
    }

    let sig = '';
    function signature() {
      const parts: string[] = [String(window.innerWidth)];
      for (const s of STREAMS) for (const [sel] of s.anchors) {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        parts.push(r ? `${Math.round(r.left)},${Math.round(r.top + window.scrollY)},${Math.round(r.width)},${Math.round(r.height)}` : '-');
      }
      return parts.join('|');
    }

    function build() {
      const next = signature();
      if (next === sig) return; // nothing moved (e.g. a tab changed inside a box of the same size): keep comets running
      sig = next;
      hops.forEach((h) => h.anims.forEach((a) => a.cancel()));
      hops = [];
      svg!.innerHTML = '';
      if (window.innerWidth < MIN_W) { svg!.style.display = 'none'; return; }
      svg!.style.display = '';
      const hostR = host!.getBoundingClientRect();
      svg!.setAttribute('width', String(hostR.width));
      svg!.setAttribute('height', String(host!.scrollHeight));
      const container = document.querySelector<HTMLElement>('#how .max-w-7xl') ?? document.querySelector<HTMLElement>('.max-w-7xl');
      if (!container) return;
      const cs = getComputedStyle(container);
      const cr = container.getBoundingClientRect();
      const contentL = cr.left + parseFloat(cs.paddingLeft) - hostR.left;
      const contentR = cr.right - parseFloat(cs.paddingRight) - hostR.left;
      const gutter = contentL; // equal on both sides
      const laneX = (side: Side, lane: 0 | 1) => {
        const off = lane === 0 ? gutter * 0.3 : gutter * 0.62;
        return side === 'left' ? off : hostR.width - off;
      };

      const gBase = mk('g', { fill: 'none', 'stroke-linecap': 'round' });
      const gFlow = mk('g', { fill: 'none', 'stroke-linecap': 'round' });
      const gPorts = mk('g', {});
      const gLabels = mk('g', {});
      svg!.append(gBase, gFlow, gPorts, gLabels);
      const ports = new Set<string>();

      for (const s of STREAMS) {
        const x = laneX(s.side, s.lane);
        const pts = s.anchors
          .map(([sel, at]) => {
            const el = document.querySelector<HTMLElement>(sel);
            if (!el || el.offsetParent === null) return null;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return null;
            const ex = s.side === 'left' ? Math.max(r.left - hostR.left, contentL) : Math.min(r.right - hostR.left, contentR);
            return { el, x: ex, y: r.top - hostR.top + r.height * at };
          })
          .filter((p): p is { el: HTMLElement; x: number; y: number } => !!p);

        // stream label at the start of the lane, set vertically in the margin
        if (pts[0]) {
          const lbl = mk('text', { x, y: pts[0].y + 26, fill: s.color, 'font-size': 9.5, 'font-weight': 700, 'letter-spacing': '0.16em',
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', transform: `rotate(90 ${x} ${pts[0].y + 26})`, 'dominant-baseline': 'middle', dx: 6, dy: s.side === 'left' ? 9 : -9, opacity: 0.85 });
          lbl.textContent = s.label.toUpperCase();
          gLabels.appendChild(lbl);
        }

        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!, b = pts[i + 1]!;
          const d = roundedPath([[a.x, a.y], [x, a.y], [x, b.y], [b.x, b.y]]);
          const base = mk('path', { d, stroke: 'rgba(100,116,139,0.3)', 'stroke-width': 1.25, class: 'net-base' }) as SVGPathElement;
          const tint = mk('path', { d, stroke: s.color, 'stroke-width': 1.5, opacity: 0.34, class: 'net-tint' }) as SVGPathElement;
          gBase.append(base, tint);
          const len = base.getTotalLength();
          const glow = mk('path', { d, stroke: s.color, 'stroke-width': 7, opacity: 0.28 }) as SVGPathElement;
          const core = mk('path', { d, stroke: s.color, 'stroke-width': 2.25 }) as SVGPathElement;
          const anims: Animation[] = [];
          if (!reduced) {
            const comet = 90;
            for (const p of [glow, core]) {
              p.style.strokeDasharray = `${comet} ${len + comet}`;
              p.style.strokeDashoffset = String(comet);
              gFlow.appendChild(p);
              anims.push(p.animate([{ strokeDashoffset: comet }, { strokeDashoffset: -len }], {
                duration: Math.max(1800, (len / SPEED) * 1000), iterations: Infinity, delay: (i * 530 + s.lane * 900) % 2600, easing: 'ease-in-out',
              }));
            }
          }
          const secs = [a.el.closest('section'), b.el.closest('section')].filter((e): e is HTMLElement => !!e);
          hops.push({ el: tint, glow, core, anims, top: Math.min(a.y, b.y) - 10, bottom: Math.max(a.y, b.y) + 10, secs });

          for (const p of [a, b]) {
            const k = `${Math.round(p.x)}:${Math.round(p.y)}`;
            if (ports.has(k)) continue;
            ports.add(k);
            gPorts.append(
              mk('circle', { cx: p.x, cy: p.y, r: 6, fill: s.color, opacity: 0.14 }),
              mk('circle', { cx: p.x, cy: p.y, r: 3, fill: '#fff', stroke: s.color, 'stroke-width': 1.75 }),
            );
          }
          // junction dots where a branch leaves the lane
          gPorts.append(mk('rect', { x: x - 2.5, y: a.y - 2.5, width: 5, height: 5, rx: 1, fill: s.color, opacity: 0.75 }));
        }
      }
      // Section buses: a horizontal trace along every band edge joins the left and right lanes, so each section visibly
      // plugs into the next. Comets alternate direction and cycle through the four stream colours.
      const xl = laneX('left', 0), xr = laneX('right', 0);
      const bands = Array.from(host!.querySelectorAll<HTMLElement>(':scope > section'));
      bands.forEach((sec, i) => {
        const y = Math.round(sec.getBoundingClientRect().top - hostR.top) + 0.5;
        const color = STREAMS[i % STREAMS.length]!.color;
        const d = i % 2 ? `M ${xr} ${y} L ${xl} ${y}` : `M ${xl} ${y} L ${xr} ${y}`;
        const tint = mk('path', { d, stroke: color, 'stroke-width': 1, opacity: 0.22 }) as SVGPathElement;
        gBase.appendChild(tint);
        for (const lx of [laneX('left', 0), laneX('left', 1), laneX('right', 1), laneX('right', 0)]) {
          gPorts.appendChild(mk('rect', { x: lx - 3, y: y - 3, width: 6, height: 6, rx: 1.5, fill: '#fff', stroke: color, 'stroke-width': 1.5 }));
        }
        const len = Math.abs(xr - xl);
        const glow = mk('path', { d, stroke: color, 'stroke-width': 6, opacity: 0.25 }) as SVGPathElement;
        const core = mk('path', { d, stroke: color, 'stroke-width': 2 }) as SVGPathElement;
        const anims: Animation[] = [];
        if (!reduced) {
          const comet = 140;
          for (const p of [glow, core]) {
            p.style.strokeDasharray = `${comet} ${len + comet}`;
            p.style.strokeDashoffset = String(comet);
            gFlow.appendChild(p);
            anims.push(p.animate([{ strokeDashoffset: comet }, { strokeDashoffset: -len }], { duration: 3800, iterations: Infinity, delay: (i * 700) % 3000, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' }));
          }
        }
        hops.push({ el: tint, glow, core, anims, top: y - 10, bottom: y + 10, secs: [sec] });
      });
      cull();
    }

    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(build); };
    // Hover: brighten the streams that touch the section under the pointer.
    let hot: Element | null = null;
    const onOver = (e: MouseEvent) => {
      const sec = (e.target as Element | null)?.closest?.('section') ?? null;
      if (sec === hot) return;
      hot = sec;
      for (const h of hops) {
        const on = !!sec && h.secs.includes(sec);
        h.el.setAttribute('opacity', on ? '0.85' : '0.34');
        h.core.setAttribute('stroke-width', on ? '3' : '2.25');
      }
    };

    build();
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', cull, { passive: true });
    window.addEventListener('load', schedule);
    host.addEventListener('mouseover', onOver);
    document.fonts?.ready.then(schedule).catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', cull);
      window.removeEventListener('load', schedule);
      host.removeEventListener('mouseover', onOver);
      hops.forEach((h) => h.anims.forEach((a) => a.cancel()));
    };
  }, []);

  return <svg ref={svgRef} className="absolute left-0 top-0 z-[5] pointer-events-none overflow-visible" aria-hidden="true" />;
}

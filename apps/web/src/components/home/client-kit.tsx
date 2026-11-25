'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type RefObject } from 'react';

/** True while the element is on screen (or once, with `once`). Used to start and pause section animations. */
export function useInView<T extends Element>(opts: { once?: boolean; threshold?: number; rootMargin?: string } = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const { once = false, threshold = 0.25, rootMargin = '0px' } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) { setInView(true); if (once) io.disconnect(); }
      else if (!once) setInView(false);
    }, { threshold, rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [once, threshold, rootMargin]);
  return [ref, inView];
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(m.matches);
    const f = () => setReduced(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return reduced;
}

/** Fades `.sr-in` blocks in once as they scroll into view. Without JS they are shown by a <noscript> rule in the page. */
export function RevealObserver() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.hx .sr-in'));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { (e.target as HTMLElement).dataset.in = '1'; io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}

/** Phone-only bottom bar: appears once the hero has scrolled away, hides again at the closing section. */
export function StickyCta({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.getElementById('top');
    const close = document.getElementById('final-cta');
    let heroGone = false, closeIn = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === hero) heroGone = !e.isIntersecting && e.boundingClientRect.top < 0;
        if (e.target === close) closeIn = e.isIntersecting;
      }
      setShow(heroGone && !closeIn);
    });
    if (hero) io.observe(hero);
    if (close) io.observe(close);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`md:hidden fixed inset-x-0 bottom-0 z-40 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-white/90 dark:bg-[#060A13]/90 backdrop-blur-xl border-t border-slate-900/[0.07] dark:border-white/[0.08] transition-transform duration-300 ${show ? 'translate-y-0' : 'translate-y-full'}`} aria-hidden={!show}>
      <Link href={href} tabIndex={show ? 0 : -1} className="btn-sheen flex items-center justify-center gap-2 w-full min-h-12 rounded-xl bg-linear-to-b/srgb from-[#10B981] to-[#059669] text-white font-semibold text-[15px] shadow-cta-emerald active:scale-[0.98]">
        {label}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
      </Link>
    </div>
  );
}

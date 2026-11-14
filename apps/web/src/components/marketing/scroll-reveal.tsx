'use client';

import { useEffect } from 'react';

/**
 * Homepage scroll reveal. Anything marked `.sr` fades and slides in the first time it scrolls into view.
 * Works in every browser (IntersectionObserver), not only those with CSS scroll-driven animation.
 *
 * Nothing is hidden until this script has run and has already marked what is on screen, so there is no flash,
 * and visitors without JavaScript or who ask for reduced motion simply see the page.
 * Once an element has appeared its reveal classes are removed, so it goes back to behaving like any other element (hover effects included).
 */
export function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const items = Array.from(document.querySelectorAll<HTMLElement>('.sr'));
    // Siblings that did not set their own order appear one after another (at most six steps, so a long list never feels slow).
    const seen = new Map<Element, number>();
    for (const el of items) {
      if (el.style.getPropertyValue('--i')) continue;
      const n = seen.get(el.parentElement!) ?? 0;
      el.style.setProperty('--i', String(Math.min(n, 5)));
      seen.set(el.parentElement!, n + 1);
    }

    const finish = (el: HTMLElement) => {
      el.classList.remove('sr', 'sr-in', 'sr-left', 'sr-right', 'sr-zoom');
      el.style.removeProperty('--i');
    };
    const show = (el: HTMLElement) => {
      el.classList.add('sr-in');
      const done = () => finish(el);
      el.addEventListener('transitionend', (e) => { if (e.target === el && e.propertyName === 'opacity') done(); }, { once: false });
      window.setTimeout(done, 1600); // safety net if a transition never fires
    };

    // What is already on screen is shown immediately, before anything is hidden.
    const vh = window.innerHeight;
    const below: HTMLElement[] = [];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) { el.classList.add('sr-in'); window.setTimeout(() => finish(el), 50); } else below.push(el);
    }
    root.classList.add('sr-on');

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        show(e.target as HTMLElement);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    below.forEach((el) => io.observe(el));

    return () => { io.disconnect(); root.classList.remove('sr-on'); items.forEach((el) => el.classList.add('sr-in')); };
  }, []);
  return null;
}

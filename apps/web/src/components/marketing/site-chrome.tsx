'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/shell/theme-toggle';

/** Hamburger menu for screens without the inline nav. Closes on Escape, on choosing a link, and on resize. */
export function MobileMenu({ items, loginHref }: { items: [string, string][]; loginHref?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const mq = window.matchMedia('(min-width: 1024px)');
    const wide = () => { if (mq.matches) setOpen(false); };
    window.addEventListener('keydown', esc); mq.addEventListener('change', wide);
    return () => { window.removeEventListener('keydown', esc); mq.removeEventListener('change', wide); };
  }, [open]);
  return (
    <div className="lg:hidden">
      <Button variant="ghost" size="icon" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="lp-menu" onClick={() => setOpen(!open)}>{open ? <X className="size-5" /> : <Menu className="size-5" />}</Button>
      {open ? (
        <nav id="lp-menu" aria-label="Sections" className="absolute inset-x-0 top-full border-b border-line bg-bg shadow-xl">
          <ul className="mx-auto max-w-6xl px-4 py-2">
            {items.map(([h, l]) => <li key={h}><a href={h} onClick={() => setOpen(false)} className="flex min-h-12 items-center text-base font-semibold">{l}</a></li>)}
            {loginHref ? <li><Link href={loginHref} className="flex min-h-12 items-center text-base font-semibold text-muted">Log in</Link></li> : null}
            <li className="flex min-h-12 items-center gap-2 text-base font-semibold text-muted sm:hidden"><ThemeToggle />Light or dark</li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

/** Thumb-reach call to action for phones. Appears after the first screen, hides while the closing call to action is visible. */
export function StickyCta({ href, label, hideWhen = 'final-cta' }: { href: string; label: string; hideWhen?: string }) {
  const [past, setPast] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > 640);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    const end = document.getElementById(hideWhen);
    const io = end ? new IntersectionObserver(([e]) => setAtEnd(!!e?.isIntersecting), { threshold: 0.1 }) : null;
    if (end && io) io.observe(end);
    return () => { window.removeEventListener('scroll', onScroll); io?.disconnect(); };
  }, [hideWhen]);
  const show = past && !atEnd;
  return (
    <div aria-hidden={!show} className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/92 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur transition-transform duration-300 lg:hidden ${show ? 'translate-y-0' : 'translate-y-full'}`}>
      <Link href={href} tabIndex={show ? 0 : -1} className="lp-wa-btn flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-bold">{label}<ArrowRight className="size-5" /></Link>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/** Header from Deep's hero draft. Additions: section links go to real anchors, a Log in link (lg+), and a phone menu
 *  (below md) that holds the nav, the theme switch and Log in, so the 360px header keeps one line. */
export const NAV: [string, string][] = [['#how', 'How It Works'], ['#flows', 'Flows'], ['#pricing', 'Pricing']];
const MENU: [string, string][] = [['#how', 'How it works'], ['#flows', 'Flows'], ['#cost', 'Cost'], ['#safety', 'Number safety'], ['#pricing', 'Pricing'], ['#faq', 'FAQ']];

export function Logo({ size = 'md' }: { size?: 'md' | 'sm' }) {
  return (
    <>
      <div className={`${size === 'sm' ? 'w-8 h-8' : 'w-9 h-9'} rounded-xl bg-linear-to-br/srgb from-emerald-500 via-emerald-600 to-indigo-600 flex items-center justify-center shadow-xs shadow-emerald-600/25 group-hover:scale-105 transition-transform duration-300`}>
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7.5 17.5H6.2C4.1 17.5 2.5 15.9 2.5 13.9C2.5 12.1 3.8 10.6 5.6 10.4C6.2 7.6 8.7 5.5 11.7 5.5C15.1 5.5 17.9 8.1 18.1 11.4C19.9 11.7 21.5 13.1 21.5 15C21.5 16.9 19.9 18.5 18 18.5H13.5L10.2 21V17.5H7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.5 9.2L10.8 12.6H13.3L11.8 15.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className={`font-jk font-extrabold ${size === 'sm' ? 'text-[17px]' : 'text-[17px] sm:text-[19px]'} tracking-[-0.03em] text-slate-900 dark:text-white`}>
        LeadBot<span className="text-emerald-600 dark:text-emerald-400">cloud</span>
      </span>
    </>
  );
}

function ThemePill({ className = '' }: { className?: string }) {
  const { setTheme } = useTheme();
  return (
    <div className={`items-center p-1 rounded-full bg-slate-100 dark:bg-slate-800/90 border border-slate-900/[0.07] dark:border-white/[0.08] ${className}`} role="group" aria-label="Theme Switcher">
      <button type="button" title="Light Mode" aria-label="Switch to Light Mode" onClick={() => setTheme('light')}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer bg-white text-slate-900 shadow-xs dark:bg-transparent dark:text-slate-400 dark:shadow-none">
        <svg className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
        <span className="hidden sm:inline">Light</span>
      </button>
      <button type="button" title="Dark Mode" aria-label="Switch to Dark Mode" onClick={() => setTheme('dark')}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer text-slate-500 hover:text-slate-800 dark:bg-slate-700 dark:text-white dark:shadow-xs">
        <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <span className="hidden sm:inline">Dark</span>
      </button>
    </div>
  );
}

export function SiteHeader({ ctaHref, ctaLabel, loggedIn }: { ctaHref: string; ctaLabel: string; loggedIn: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-white/80 dark:bg-[#060A13]/80 border-b border-slate-900/[0.06] dark:border-white/[0.07] transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 sm:gap-4">
        <Link href="/" className="flex items-center gap-2.5 group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg shrink-0" aria-label="LeadBotCloud home">
          <Logo />
        </Link>

        <nav className="hidden md:flex items-center gap-1" aria-label="Primary Navigation">
          {NAV.map(([h, l]) => (
            <a key={h} href={h} className="px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05] transition-colors">
              {l}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          {!loggedIn ? (
            <Link href="/login" className="hidden lg:inline-flex px-2 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
              Log in
            </Link>
          ) : null}
          <ThemePill className="hidden sm:flex" />
          <Link href={ctaHref} className="btn-sheen inline-flex items-center h-10 sm:h-auto px-4 py-2 rounded-xl bg-slate-900 dark:bg-emerald-500 text-white text-[13px] sm:text-sm font-semibold whitespace-nowrap hover:bg-slate-800 dark:hover:bg-emerald-400 transition-all duration-200 shadow-xs active:scale-[0.98]">
            {ctaLabel}
          </Link>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 -mr-1.5 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06] cursor-pointer">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <div id="mobile-menu" className="md:hidden border-t border-slate-900/[0.06] dark:border-white/[0.07] bg-white/95 dark:bg-[#060A13]/95 backdrop-blur-xl">
          <nav className="max-w-7xl mx-auto px-4 py-3 grid grid-cols-2 gap-1" aria-label="Sections">
            {MENU.map(([h, l]) => (
              <a key={h} href={h} onClick={() => setOpen(false)} className="flex items-center min-h-11 px-3 rounded-xl text-[15px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]">
                {l}
              </a>
            ))}
          </nav>
          <div className="max-w-7xl mx-auto px-4 pb-4 flex items-center justify-between gap-3">
            <ThemePill className="flex" />
            {!loggedIn ? (
              <Link href="/login" className="inline-flex items-center min-h-11 px-4 rounded-xl text-[15px] font-semibold text-slate-700 dark:text-slate-200 border border-slate-900/[0.1] dark:border-white/[0.12]">
                Log in
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}

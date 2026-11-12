'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, ChevronsLeft, ChevronsRight, MoreHorizontal, Search, X } from 'lucide-react';
import { allNav, mobileTabs, navGroups, titleFor } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { CommandPalette } from '@/components/shell/command-palette';
import { AccountMenu, type WorkspaceInfo } from '@/components/shell/account-menu';

const KEY = 'lbc.sidebar.collapsed';

function Logo({ small }: { small?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grad-bg flex size-9 shrink-0 items-center justify-center rounded-xl text-base font-black text-white shadow-lg shadow-emerald-500/30">L</span>
      {!small ? <span className="font-display text-lg font-extrabold tracking-tight text-white">LeadBot<span className="grad-text">Cloud</span></span> : null}
    </span>
  );
}

export function AppShell({ children, user, workspace, workspaces }: { children: React.ReactNode; user: { name: string; email: string }; workspace: WorkspaceInfo; workspaces: { id: string; name: string }[] }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(KEY) === '1'); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* storage blocked */ }
  }, [collapsed]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => setMore(false), [path]);

  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  const tabs = mobileTabs.map((h) => allNav.find((n) => n.href === h)!);
  const moreActive = !mobileTabs.some((h) => active(h));

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside
        aria-label="Sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar text-sidebarink transition-[width] duration-300 ease-out md:flex',
          collapsed ? 'w-[4.5rem]' : 'w-[16.5rem]',
        )}
      >
        <div className={cn('flex h-16 items-center', collapsed ? 'justify-center' : 'px-5')}>
          <Logo small={collapsed} />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
          {navGroups.map((g) => (
            <div key={g.title} className="mb-4">
              {!collapsed ? <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebarink/50">{g.title}</p> : <div className="mx-3 mb-2 h-px bg-white/10" />}
              <ul className="flex flex-col gap-1">
                {g.items.map(({ href, label, Icon, built }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      title={collapsed ? label : undefined}
                      aria-current={active(href) ? 'page' : undefined}
                      className={cn(
                        'group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                        collapsed && 'justify-center px-0',
                        active(href) ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white',
                      )}
                    >
                      {active(href) ? <span className="grad-bg absolute left-0 top-2 h-7 w-1 rounded-r-full" /> : null}
                      <Icon className={cn('size-5 shrink-0 transition-transform group-hover:scale-110', active(href) && 'text-emerald-300')} />
                      {!collapsed ? <span className="flex-1">{label}</span> : null}
                      {!collapsed && !built ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/60">Soon</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className={cn('flex items-center border-t border-white/10 p-3', collapsed ? 'flex-col gap-2' : 'justify-between')}>
          <div className={cn('min-w-0', collapsed ? '' : 'flex-1')}><AccountMenu user={user} workspace={workspace} workspaces={workspaces} collapsed={collapsed} onDark /></div>
          <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed} className="flex size-10 items-center justify-center rounded-xl hover:bg-white/10">
            {collapsed ? <ChevronsRight className="size-5" /> : <ChevronsLeft className="size-5" />}
          </button>
        </div>
      </aside>

      <div className={cn('flex min-h-dvh min-w-0 flex-col pb-16 transition-[padding] duration-300 md:pb-0', collapsed ? 'md:pl-[4.5rem]' : 'md:pl-[16.5rem]')}>
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl md:px-8">
          <span className="md:hidden"><span className="grad-bg flex size-9 items-center justify-center rounded-xl text-base font-black text-white">L</span></span>
          <h1 className="font-display text-lg font-bold md:text-xl">{titleFor(path)}</h1>
          <button onClick={() => setPalette(true)} className="ml-auto hidden h-10 w-72 items-center gap-2 rounded-xl border border-line bg-card px-3 text-sm text-muted hover:border-brand/50 md:flex" aria-label="Open search">
            <Search className="size-4" />Search or jump to…<kbd className="ml-auto rounded-md border border-line px-1.5 text-[11px]">Ctrl K</kbd>
          </button>
          <span className="ml-auto flex items-center gap-1 md:ml-0">
            <button onClick={() => setPalette(true)} aria-label="Search" className="flex size-11 items-center justify-center rounded-xl hover:bg-ink/5 md:hidden"><Search className="size-5" /></button>
            <span className="hidden items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold lg:flex"><span className="live-dot size-2 rounded-full bg-brand" />Number healthy</span>
            <ThemeToggle />
            <button aria-label="Notifications" className="relative flex size-11 items-center justify-center rounded-xl hover:bg-ink/5"><Bell className="size-5" /><span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-rose" /></button>
          </span>
        </header>
        <main className="mx-auto w-full max-w-[88rem] flex-1 px-4 py-5 md:px-8 md:py-8">{children}</main>
      </div>

      {/* Phone bottom bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {tabs.map(({ href, label, Icon }) => (
          <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined} className={cn('relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', active(href) ? 'text-brand' : 'text-muted')}>
            {active(href) ? <span className="grad-bg absolute top-0 h-1 w-8 rounded-b-full" /> : null}
            <Icon className="size-[22px]" />{label}
          </Link>
        ))}
        <button onClick={() => setMore(true)} className={cn('relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', moreActive ? 'text-brand' : 'text-muted')} aria-haspopup="dialog">
          {moreActive ? <span className="grad-bg absolute top-0 h-1 w-8 rounded-b-full" /> : null}
          <MoreHorizontal className="size-[22px]" />More
        </button>
      </nav>

      {/* Phone "More" sheet */}
      {more ? (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => setMore(false)} role="presentation">
          <div role="dialog" aria-modal="true" aria-label="More" className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] [animation:sheet-in_0.28s_cubic-bezier(0.2,0.8,0.2,1)]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />
            <div className="mb-3 flex items-center justify-between"><p className="font-display text-lg font-bold">More</p><button onClick={() => setMore(false)} aria-label="Close" className="flex size-11 items-center justify-center rounded-xl hover:bg-ink/5"><X className="size-5" /></button></div>
            <div className="mb-4 rounded-2xl border border-line bg-card2 p-1.5"><AccountMenu user={user} workspace={workspace} workspaces={workspaces} /></div>
            <div className="grid grid-cols-3 gap-3">
              {allNav.filter((n) => !mobileTabs.includes(n.href as (typeof mobileTabs)[number])).map(({ href, label, Icon }) => (
                <Link key={href} href={href} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-card2 text-sm font-semibold active:scale-95">
                  <span className="grad-bg flex size-11 items-center justify-center rounded-xl text-white"><Icon className="size-5" /></span>{label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

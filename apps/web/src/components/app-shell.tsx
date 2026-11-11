'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CreditCard,
  FileText,
  HeartPulse,
  Home,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Send,
  Settings,
  Users,
  Zap,
} from 'lucide-react';
import { i18n } from '@lbc/shared';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';

const t = i18n.en;

/** Mobile bottom nav is fixed by spec A4.18. */
const mobile = [
  { href: '/home', label: t.nav.home, Icon: Home },
  { href: '/chats', label: t.nav.chats, Icon: MessageCircle },
  { href: '/send', label: t.nav.send, Icon: Send },
  { href: '/customers', label: t.nav.customers, Icon: Users },
  { href: '/more', label: t.nav.more, Icon: MoreHorizontal },
] as const;

/** Desktop sidebar: only the screens people use every day, grouped. */
const groups = [
  {
    title: 'Daily',
    items: [
      { href: '/home', label: 'Home', Icon: Home },
      { href: '/chats', label: 'Chats', Icon: MessageCircle },
      { href: '/send', label: 'Send to customers', Icon: Send },
      { href: '/customers', label: 'Customers', Icon: Users },
    ],
  },
  {
    title: 'Grow',
    items: [
      { href: '/formats', label: 'Message formats', Icon: FileText },
      { href: '/renewals', label: 'Renewals', Icon: RefreshCw },
      { href: '/automation', label: 'Auto-replies', Icon: Zap },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/health', label: 'Number health', Icon: HeartPulse },
      { href: '/billing', label: 'Plan and billing', Icon: CreditCard },
      { href: '/settings', label: 'Settings', Icon: Settings },
    ],
  },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  // A conversation is full-screen on phones, so hide the bottom bar there.
  const inConversation = /^\/chats\/[^/]+/.test(path);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-border bg-card md:flex md:flex-col md:gap-5 md:overflow-y-auto md:p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-lg font-bold text-primary">
            <BarChart3 className="size-5" />
            {t.app.name}
          </span>
          <ThemeToggle />
        </div>
        {groups.map((g) => (
          <nav key={g.title} aria-label={g.title} className="flex flex-col gap-1">
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>
            {g.items.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={active(href) ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-muted',
                  active(href) && 'bg-primary/10 text-primary',
                )}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            ))}
          </nav>
        ))}
      </aside>

      <div className={cn('flex min-h-dvh flex-col md:pb-0', !inConversation && 'pb-16')}>
        <header className={cn('flex items-center justify-between border-b border-border bg-card px-4 py-2 md:hidden', inConversation && 'hidden')}>
          <span className="font-bold text-primary">{t.app.name}</span>
          <ThemeToggle />
        </header>
        <main className={cn('mx-auto w-full flex-1 p-4 md:p-8', path.startsWith('/chats') ? 'max-w-[110rem]' : 'max-w-5xl')}>{children}</main>
      </div>

      <nav
        aria-label="Main"
        className={cn('fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-border bg-card md:hidden', inConversation && 'hidden')}
      >
        {mobile.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? 'page' : undefined}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground',
              active(href) && 'text-primary',
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageCircle, MoreHorizontal, Send, Users } from 'lucide-react';
import { i18n } from '@lbc/shared';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';

const t = i18n.en;

// Spec A4.18: bottom navigation on mobile is Home, Chats, Send, Customers, More.
const items = [
  { href: '/home', label: t.nav.home, Icon: Home },
  { href: '/chats', label: t.nav.chats, Icon: MessageCircle },
  { href: '/send', label: t.nav.send, Icon: Send },
  { href: '/customers', label: t.nav.customers, Icon: Users },
  { href: '/more', label: t.nav.more, Icon: MoreHorizontal },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-border bg-card md:flex md:flex-col md:gap-1 md:p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-lg font-bold text-primary">{t.app.name}</span>
          <ThemeToggle />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {items.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-muted',
                active(href) && 'bg-muted text-primary',
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-dvh flex-col pb-16 md:pb-0">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2 md:hidden">
          <span className="font-bold text-primary">{t.app.name}</span>
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">{children}</main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-border bg-card md:hidden"
      >
        {items.map(({ href, label, Icon }) => (
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

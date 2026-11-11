'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CreditCard,
  FileText,
  HeartPulse,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Send,
  Settings,
  Users,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { TopBar } from '@/components/top-bar';

/** Desktop rail (AiSensy-style): icon above a small label, dark teal. */
const rail = [
  { href: '/home', label: 'Dashboard', Icon: LayoutDashboard, title: 'Dashboard' },
  { href: '/chats', label: 'Live Chat', Icon: MessageSquare, title: 'Live Chat' },
  { href: '/customers', label: 'Contacts', Icon: Users, title: 'Contacts' },
  { href: '/send', label: 'Campaigns', Icon: Send, title: 'Campaigns' },
  { href: '/formats', label: 'Templates', Icon: FileText, title: 'Message Templates' },
  { href: '/renewals', label: 'Renewals', Icon: RefreshCw, title: 'Renewals' },
  { href: '/automation', label: 'Replies', Icon: Zap, title: 'Auto-replies' },
  { href: '/health', label: 'Health', Icon: HeartPulse, title: 'Number Health' },
  { href: '/billing', label: 'Billing', Icon: CreditCard, title: 'Plan and Billing' },
  { href: '/settings', label: 'Manage', Icon: Settings, title: 'Manage' },
] as const;

const mobile = [
  { href: '/home', label: 'Home', Icon: LayoutDashboard },
  { href: '/chats', label: 'Chats', Icon: MessageSquare },
  { href: '/send', label: 'Campaigns', Icon: Send },
  { href: '/customers', label: 'Contacts', Icon: Users },
  { href: '/more', label: 'More', Icon: MoreHorizontal },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  const inConversation = /^\/chats\/[^/]+/.test(path);
  const current = rail.find((r) => active(r.href));
  const title = current?.title ?? (path.startsWith('/more') ? 'More' : path.startsWith('/connect') ? 'Connect WhatsApp' : 'LeadBotCloud');
  const wide = path.startsWith('/chats');

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[5.25rem_minmax(0,1fr)]">
      <aside className="hidden bg-[#0b3b36] text-white md:flex md:h-dvh md:flex-col md:items-center md:gap-1 md:overflow-y-auto md:py-3 md:sticky md:top-0">
        <Link href="/home" aria-label="LeadBotCloud home" className="mb-2 flex size-11 items-center justify-center rounded-xl bg-white/10 text-lg font-black text-green-300">L</Link>
        <nav aria-label="Main" className="flex w-full flex-1 flex-col items-center gap-0.5">
          {rail.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? 'page' : undefined}
              className={cn(
                'flex w-[4.5rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium text-white/75 hover:bg-white/10 hover:text-white',
                active(href) && 'bg-white/15 text-white',
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
        <Link href="/connect" aria-label="Account" className="mt-1 flex size-9 items-center justify-center rounded-full bg-orange-500 text-sm font-bold">D</Link>
      </aside>

      <div className={cn('flex min-h-dvh min-w-0 flex-col', !inConversation && 'pb-16 md:pb-0')}>
        <div className={cn(inConversation && 'hidden md:block')}><TopBar title={title} /></div>
        <main className={cn('mx-auto w-full flex-1 p-4 md:p-6', wide ? 'max-w-[110rem]' : 'max-w-6xl')}>{children}</main>
      </div>

      <nav aria-label="Main" className={cn('fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-border bg-card md:hidden', inConversation && 'hidden')}>
        {mobile.map(({ href, label, Icon }) => (
          <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined} className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground', active(href) && 'text-primary')}>
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

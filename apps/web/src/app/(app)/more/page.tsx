import Link from 'next/link';
import { ChevronRight, CreditCard, FileText, HeartPulse, RefreshCw, Settings, Zap } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

const items = [
  { href: '/formats', label: 'Message formats', hint: 'Get messages approved by WhatsApp', Icon: FileText },
  { href: '/renewals', label: 'Renewals', hint: 'Reminders and payment links', Icon: RefreshCw },
  { href: '/automation', label: 'Auto-replies', hint: 'Welcome, away and keyword replies', Icon: Zap },
  { href: '/health', label: 'Number health', hint: 'Keep your number safe', Icon: HeartPulse },
  { href: '/billing', label: 'Plan and billing', hint: 'Your plan, invoices and cancel', Icon: CreditCard },
  { href: '/settings', label: 'Settings', hint: 'Business, team and limits', Icon: Settings },
] as const;

const legal = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/contact', label: 'Contact us' },
];

export default function MorePage() {
  return (
    <div>
      <PageHeader title="More" />
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.map(({ href, label, hint, Icon }) => (
          <li key={href}>
            <Link href={href} className="flex min-h-16 items-center gap-3 px-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
              <span className="flex-1"><span className="block font-semibold">{label}</span><span className="text-sm text-muted-foreground">{hint}</span></span>
              <ChevronRight className="size-5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex flex-wrap gap-4 text-sm text-muted-foreground">
        {legal.map((l) => <Link key={l.href} href={l.href} className="min-h-11 content-center">{l.label}</Link>)}
      </p>
      <a href="https://wa.me/918250919483" className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary">Need help? Chat with us on WhatsApp</a>
    </div>
  );
}

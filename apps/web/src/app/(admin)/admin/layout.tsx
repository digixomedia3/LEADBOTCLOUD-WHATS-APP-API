import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';

export const metadata: Metadata = { title: 'Platform admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const NAV = [['/admin', 'Overview'], ['/admin/attention', 'Needs attention'], ['/admin/workspaces', 'Workspaces'], ['/admin/accounts', 'People'], ['/admin/closures', 'Closures'], ['/admin/revenue', 'Revenue'], ['/admin/audit', 'Audit log'], ['/admin/announcements', 'Announcements'], ['/admin/staff', 'Staff']] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const a = await requireAdmin();   // anyone else gets the ordinary "not found" page
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-display text-base font-extrabold">LeadBotCloud <span className="rounded-md bg-rose/15 px-1.5 py-0.5 text-xs font-bold text-rose">PLATFORM ADMIN</span></span>
          <nav className="-mx-1 flex gap-1 overflow-x-auto" aria-label="Admin">{NAV.map(([href, label]) => <Link key={href} href={href} className="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold hover:bg-ink/5">{label}</Link>)}</nav>
          <span className="ml-auto text-xs text-muted">{a.email} · <Link href="/dashboard" className="underline">Back to the app</Link></span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
    </div>
  );
}

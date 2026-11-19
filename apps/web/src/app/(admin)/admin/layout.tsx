import type { Metadata } from 'next';
import Link from 'next/link';
import { getAdminState, requireAdmin } from '@/lib/admin';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Platform admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const NAV = [['/admin', 'Overview'], ['/admin/attention', 'Needs attention'], ['/admin/workspaces', 'Workspaces'], ['/admin/accounts', 'People'], ['/admin/closures', 'Closures'], ['/admin/revenue', 'Revenue'], ['/admin/audit', 'Audit log'], ['/admin/announcements', 'Announcements'], ['/admin/staff', 'Staff']] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Staff without two-step sign-in are told why and where to fix it. Everyone who is not staff still gets the ordinary "not found" page.
  const st = await getAdminState();
  if (st.state === 'no') notFound();
  if (st.state === 'needs2fa') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-ink">
        <h1 className="font-display text-2xl font-bold">Turn on two-step sign-in first</h1>
        <p className="text-sm text-muted">The platform admin pages can read people&apos;s details and end their sign-ins, so they only open for staff who sign in with an authenticator app as well as a password.</p>
        <Link href="/settings?tab=security" className="grad-bg inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold text-white">Set it up in Settings</Link>
        <Link href="/dashboard" className="text-center text-sm underline">Back to the app</Link>
      </div>
    );
  }
  const a = await requireAdmin();
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

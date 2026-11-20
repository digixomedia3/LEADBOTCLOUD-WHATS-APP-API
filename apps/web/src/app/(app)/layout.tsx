import { AppShell } from '@/components/shell/app-shell';
import { AnnouncementBanner } from '@/components/shell/announcement-banner';
import { SuspendedNotice } from '@/components/shell/suspended-notice';
import { ViewBanner } from '@/components/shell/view-banner';
import { requireCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  return (
    <AppShell
      user={{ name: ctx.user.name, email: ctx.user.email }}
      workspace={{ id: ctx.tenantId, name: ctx.workspace.name, role: ctx.role, plan: ctx.workspace.plan }}
      workspaces={ctx.workspaces.map((w) => ({ id: w.tenantId, name: w.name }))}
    >
      {ctx.viewing ? <ViewBanner tenantName={ctx.viewing.tenantName} reason={ctx.viewing.reason} expiresAt={ctx.viewing.expiresAt} /> : null}
      <SuspendedNotice ctx={ctx} />
      <AnnouncementBanner userId={ctx.user.id} />
      {children}
    </AppShell>
  );
}

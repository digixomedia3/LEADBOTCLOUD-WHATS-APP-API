import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { withUser, tenants, tenantMembers, type Role } from '@lbc/db';
import { auth } from '@/lib/auth';

export { appDb, assertRole, audit, db, Forbidden } from './tenant-db';
import { appDb } from './tenant-db';

export const WORKSPACE_COOKIE = 'lbc_ws';
/** A random id for a live staff view. It proves nothing by itself: every request asks the database whether it is a live view of THIS signed-in staff member. */
export const VIEW_COOKIE = 'lbc_view';

export interface Membership { tenantId: string; name: string; role: Role; plan: string }
export interface Ctx {
  user: { id: string; name: string; email: string };
  tenantId: string;
  workspace: Membership;
  workspaces: Membership[];
  role: Role;
  /** Set only while platform staff are looking at this workspace. Everything is read-only. */
  viewing?: { id: string; tenantName: string; reason: string; expiresAt: string };
  readOnly?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** Workspaces the signed-in user belongs to. Read through RLS with only the user context set. */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const rows = await withUser(appDb, userId, (tx) =>
    tx
      .select({ tenantId: tenants.id, name: tenants.name, plan: tenants.planId, role: tenantMembers.role })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(eq(tenantMembers.userId, userId)),
  );
  return rows.map((r) => ({ ...r, role: r.role as Role })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves the signed-in user and the active workspace, or redirects.
 * The active workspace comes from a cookie, but it is only honoured if the user really is a member
 * (checked against the database each request), so tampering with the cookie grants nothing.
 */
export const requireCtx = cache(async (): Promise<Ctx> => {
  const s = await getSession();
  if (!s) redirect('/login');
  // Staff looking at a customer's workspace: only if the database says this id is a live view that belongs to this very staff member (and staff still has two-step on).
  const viewId = (await cookies()).get(VIEW_COOKIE)?.value;
  if (viewId && UUID.test(viewId)) {
    const v = await withUser(appDb, s.user.id, async (tx) => ((await tx.execute(sql`select public.admin_view_get(${viewId}::uuid) as v`)) as unknown as { v: { tenantId: string; tenantName: string; plan: string; reason: string; expiresAt: string } | null }[])[0]?.v ?? null).catch(() => null);
    if (v) {
      const workspace: Membership = { tenantId: v.tenantId, name: v.tenantName, role: 'viewer', plan: v.plan };
      return { user: { id: s.user.id, name: s.user.name, email: s.user.email }, tenantId: v.tenantId, workspace, workspaces: [workspace], role: 'viewer', readOnly: true, viewing: { id: viewId, tenantName: v.tenantName, reason: v.reason, expiresAt: v.expiresAt } };
    }
  }
  const workspaces = await listMemberships(s.user.id);
  if (workspaces.length === 0) redirect('/onboarding');
  const wanted = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const workspace = workspaces.find((w) => w.tenantId === wanted) ?? workspaces[0]!;
  return { user: { id: s.user.id, name: s.user.name, email: s.user.email }, tenantId: workspace.tenantId, workspace, workspaces, role: workspace.role };
});

export async function createWorkspaceFor(userId: string, name: string, vertical: string, review: 'none' | 'flagged', terms: string): Promise<string> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const r = await tx.execute(sql`select public.create_workspace(${userId}, ${name}, ${vertical}, ${review}, ${terms}) as id`);
    return (r as unknown as { id: string }[])[0]!.id;
  });
}

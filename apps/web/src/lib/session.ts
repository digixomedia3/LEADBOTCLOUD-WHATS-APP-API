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

export interface Membership { tenantId: string; name: string; role: Role; plan: string }
export interface Ctx {
  user: { id: string; name: string; email: string };
  tenantId: string;
  workspace: Membership;
  workspaces: Membership[];
  role: Role;
}

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

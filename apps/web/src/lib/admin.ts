import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { withUser } from '@lbc/db';
import { appDb } from '@/lib/tenant-db';
import { getSession } from '@/lib/session';

/**
 * Platform staff only. Everything here runs as the normal `app` database role (never the RLS-bypassing worker role): each admin_* database
 * function checks the caller is listed in platform_admins before doing one narrow thing, and writes an audit entry naming the admin.
 * Anyone who is not staff sees an ordinary "not found" page, so the panel is not even discoverable.
 */
export interface AdminSession { userId: string; name: string; email: string }

/** Null for everyone who is not platform staff, including signed-out visitors. */
export const getAdmin = cache(async (): Promise<AdminSession | null> => {
  const r = await getAdminState();
  return r.state === 'ok' ? r.admin : null;
});

/**
 * Staff must have two-step sign-in on. Without it the admin pages behave as if they did not exist, exactly like for any customer, and /settings explains why.
 * `needs2fa` is only ever returned to someone who IS staff, so the pages stay undiscoverable to everyone else.
 */
export const getAdminState = cache(async (): Promise<{ state: 'ok'; admin: AdminSession } | { state: 'needs2fa'; admin: AdminSession } | { state: 'no' }> => {
  const s = await getSession();
  if (!s) return { state: 'no' };
  const row = await withUser(appDb, s.user.id, async (tx) => ((await tx.execute(sql`select public.is_platform_admin() as staff, (select u.two_factor_enabled from public."user" u where u.id = ${s.user.id}) as tf`)) as unknown as { staff: boolean; tf: boolean }[])[0]);
  if (row?.staff !== true) return { state: 'no' };
  const admin = { userId: s.user.id, name: s.user.name, email: s.user.email };
  return row.tf === true ? { state: 'ok', admin } : { state: 'needs2fa', admin };
});

export async function requireAdmin(): Promise<AdminSession> {
  const a = await getAdmin();
  if (!a) notFound();
  return a;
}

/** Runs one admin database function as this admin. Returns plain-words errors, never raw database text for permission failures. */
export async function adminCall<T>(admin: AdminSession, run: (tx: Parameters<Parameters<typeof withUser>[2]>[0]) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await withUser(appDb, admin.userId, run) };
  } catch (e) {
    const err = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    const code = err.cause?.code ?? err.code; const msg = err.cause?.message ?? err.message ?? '';
    if (code === '42501' || /platform admin only/i.test(msg)) return { ok: false, error: 'Your account is not allowed to do this.' };
    // The functions raise short, plain messages for bad input (22023) and missing things (P0002). Anything else is not shown.
    if (code === '22023' || code === 'P0002') return { ok: false, error: msg.replace(/^.*?error: /i, '').slice(0, 200) };
    console.error('[admin] call failed', code, msg.slice(0, 200));
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}

export const one = <T,>(rows: unknown, key: string): T => (rows as Record<string, T>[])[0]![key]!;

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
  const s = await getSession();
  if (!s) return null;
  const ok = await withUser(appDb, s.user.id, async (tx) => ((await tx.execute(sql`select public.is_platform_admin() as ok`)) as unknown as { ok: boolean }[])[0]?.ok === true);
  return ok ? { userId: s.user.id, name: s.user.name, email: s.user.email } : null;
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

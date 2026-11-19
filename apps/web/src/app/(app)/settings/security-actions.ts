'use server';

import QRCode from 'qrcode';
import { sql } from 'drizzle-orm';
import { withUser } from '@lbc/db';
import { appDb } from '@/lib/tenant-db';
import { getSession } from '@/lib/session';

export interface SecurityInfo { enabled: boolean; staff: boolean }

/** Whether the signed-in person has two-step sign-in on, and whether they are platform staff (who must). Reads nothing secret. */
export async function loadSecurity(): Promise<SecurityInfo> {
  const s = await getSession();
  if (!s) return { enabled: false, staff: false };
  return withUser(appDb, s.user.id, async (tx) => {
    const r = (await tx.execute(sql`select u.two_factor_enabled as enabled, public.is_platform_admin() as staff from public."user" u where u.id = ${s.user.id}`)) as unknown as { enabled: boolean; staff: boolean }[];
    return { enabled: r[0]?.enabled === true, staff: r[0]?.staff === true };
  });
}

/** Draws the authenticator setup link as a QR picture here on the server. The secret is never sent to an outside QR service. Only otpauth links are drawn. */
export async function qrForSetup(uri: string): Promise<{ ok: true; svg: string } | { ok: false }> {
  const s = await getSession(); if (!s) return { ok: false };
  if (typeof uri !== 'string' || uri.length > 400 || !uri.startsWith('otpauth://totp/')) return { ok: false };
  return { ok: true, svg: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
}

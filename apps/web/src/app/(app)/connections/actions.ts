'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ConnectorError, hashState } from '@lbc/connectors';
import { decryptSecret, encryptSecret } from '@lbc/meta';
import { Forbidden, assertRole, db, requireCtx, type Ctx } from '@/lib/session';
import { availability, meta, tokenKey, type Provider } from '@/lib/connectors';
import { sheetIdFrom } from '@/lib/sheet-link';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = (r: unknown) => r as R[];

async function admin(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return { error: 'Only an owner or admin can change connections.' }; throw e; }
  return { ctx };
}

export interface ConnectionRow {
  id: string; provider: Provider; externalId: string; label: string; status: 'active' | 'needs_reauth'; lastSyncAt: string | null; lastError: string | null; connectedAt: string;
  config: { spreadsheetId?: string; sheet?: string; nextRow?: number }; leads: number; sourceId: string | null;
}
export interface ConnectionsData { rows: ConnectionRow[]; availability: ReturnType<typeof availability>; canManage: boolean }

/** Safe columns only: the database role used here cannot read tokens at all. */
export async function listConnections(): Promise<ConnectionsData> {
  const ctx = await requireCtx();
  const r = await db(ctx, async (tx) => rows(await tx.execute(sql`select c.id, c.provider, c.external_id, c.label, c.status, c.last_sync_at, c.last_error, c.created_at, c.config, c.source_id,
    (select count(*)::int from leads l where l.source_id = c.source_id) as leads from connections c order by c.created_at desc`)));
  return {
    availability: availability(), canManage: ctx.role === 'owner' || ctx.role === 'admin',
    rows: r.map((x) => ({ id: x.id, provider: x.provider, externalId: x.external_id, label: x.label, status: x.status, lastSyncAt: x.last_sync_at ? new Date(x.last_sync_at).toISOString() : null, lastError: x.last_error, connectedAt: new Date(x.created_at).toISOString(), config: x.config ?? {}, leads: x.leads, sourceId: x.source_id })),
  };
}

export async function disconnect(id: string): Promise<Result> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  try {
    await db(g.ctx, (tx) => tx.execute(sql`select public.disconnect_connection(${id})`));
  } catch (e) { return fail((e as Error).message.includes('not_found') ? 'That connection no longer exists.' : 'Could not disconnect. Try again.'); }
  revalidatePath('/connections');
  return { ok: true as const, data: null };
}

const sheetSchema = z.object({ link: z.string().min(1).max(400), tab: z.string().trim().max(60).regex(/^[\w .-]*$/, 'Tab names can use letters, numbers, spaces, dots, dashes and underscores.').optional() });
export async function setSheet(id: string, input: z.input<typeof sheetSchema>): Promise<Result> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  const p = sheetSchema.safeParse(input); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  const sid = sheetIdFrom(p.data.link); if (!sid) return fail('Paste the full Google Sheet link (it contains /spreadsheets/d/…).');
  // The web role may change only `config` (token columns and status are worker-owned), so this writes nothing else. Any database refusal is shown, never swallowed.
  let r: R[];
  try {
    r = rows(await db(g.ctx, (tx) => tx.execute(sql`update connections set config = jsonb_build_object('spreadsheetId', ${sid}::text, 'sheet', ${p.data.tab || 'Sheet1'}::text, 'nextRow', 2), updated_at = now()
      where id = ${id} and provider = 'google_sheets' returning id`)));
  } catch { return fail('Could not save the sheet. Try again.'); }
  if (!r.length) return fail('That connection no longer exists.');
  revalidatePath('/connections');
  return { ok: true as const, data: null };
}

export interface PickData { pages: { id: string; name: string }[] }
/** Lists the Pages found for this pending connection. Names only; the tokens never reach the browser. */
export async function pendingPages(pick: string): Promise<Result<PickData>> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  const s = await db(g.ctx, async (tx) => rows(await tx.execute(sql`select public.peek_oauth_state(${hashState(pick)}, 'meta_lead_ads') as s`))[0]?.s as { extra: { pages: { id: string; name: string }[] } } | null);
  if (!s) return fail('This step expired. Start the connection again.');
  return { ok: true as const, data: { pages: s.extra.pages.map((p) => ({ id: p.id, name: p.name })) } };
}

export async function choosePage(pick: string, pageId: string): Promise<Result> {
  const g = await admin(); if ('error' in g) return fail(g.error);
  const m = meta(); if (!m) return fail('Facebook is not configured on this installation.');
  const s = await db(g.ctx, async (tx) => rows(await tx.execute(sql`select public.peek_oauth_state(${hashState(pick)}, 'meta_lead_ads') as s`))[0]?.s as { extra: { pages: { id: string; name: string; token: string }[]; scopes: string[] } } | null);
  if (!s) return fail('This step expired. Start the connection again.');
  const page = s.extra.pages.find((p) => p.id === pageId);
  if (!page) return fail('That Page is not in your list.');
  const token = decryptSecret(page.token, tokenKey());
  // Subscribe first, so a Page is never shown as connected while Facebook is not actually sending its leads.
  try { await m.subscribePage(page.id, token); }
  catch (e) { return fail(e instanceof ConnectorError ? `Facebook refused to send leads from this Page: ${e.message}` : 'Could not reach Facebook. Try again.'); }
  // Single use: whoever consumes the state wins. A double click cannot connect twice.
  const used = await db(g.ctx, async (tx) => rows(await tx.execute(sql`select public.consume_oauth_state(${hashState(pick)}, 'meta_lead_ads') as s`))[0]?.s);
  if (!used) return fail('This step was already used. Start the connection again.');
  try {
    await db(g.ctx, (tx) => tx.execute(sql`select public.store_connection('meta_lead_ads', ${page.id}, ${page.name}, ${encryptSecret(token, tokenKey())}, null, null::timestamptz,
      (select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(s.extra.scopes)}::jsonb) x), '{}'::jsonb)`));
  } catch (e) {
    try { await m.unsubscribePage(page.id, token); } catch { /* best effort: do not leave Facebook sending to a Page we do not hold */ }
    return fail((e as Error).message.includes('connection_in_use') ? 'This Page is already connected to another workspace.' : 'Could not save the connection. Try again.');
  }
  revalidatePath('/connections');
  return { ok: true as const, data: null };
}

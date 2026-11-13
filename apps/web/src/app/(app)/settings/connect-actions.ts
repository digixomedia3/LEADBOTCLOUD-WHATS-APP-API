'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { GraphClient, SignupError, completeSignup, type SessionInfo } from '@lbc/meta';
import { Forbidden, assertRole, audit, db, requireCtx, type Ctx } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
type R = Record<string, unknown>;
const rows = (r: unknown) => r as R[];

const env = () => ({
  appId: process.env.META_APP_ID || '', appSecret: process.env.META_APP_SECRET || '', configId: process.env.META_ES_CONFIG_ID || '',
  version: process.env.META_GRAPH_VERSION || 'v26.0', baseUrl: process.env.META_GRAPH_BASE_URL || undefined, key: process.env.TOKEN_ENCRYPTION_KEY || '',
});
const connectConfigured = () => { const e = env(); return !!(e.appId && e.appSecret && e.configId && e.key); };

async function guard(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return { error: 'Only an owner or admin can connect WhatsApp.' }; throw e; }
  return { ctx };
}

export interface ConnectionView {
  configured: boolean;
  /** Public values the browser needs to open the Meta window. Never the secret. */
  sdk: { appId: string; configId: string; version: string } | null;
  connection: null | {
    wabaId: string; businessId: string | null; tokenStatus: string; health: string; payment: string; mm: string | null; subscribed: boolean | null; checkedAt: string | null;
    phone: null | { display: string | null; verifiedName: string | null; quality: string | null; status: string | null; tier: string | null; nameStatus: string | null; platform: string | null; onBizApp: boolean | null; syncedAt: string | null };
  };
  lastAttempt: null | { event: string | null; error: string | null; at: string };
  canManage: boolean;
}

export async function getConnection(): Promise<ConnectionView> {
  const ctx = await requireCtx();
  const e = env();
  return db(ctx, async (tx) => {
    const a = rows(await tx.execute(sql`select id, business_id, messaging_account_id, token_status, health_state, payment_method_status, mm_api_status, subscribed_apps_ok, token_checked_at from meta_accounts limit 1`))[0];
    const p = a ? rows(await tx.execute(sql`select display_phone_number, verified_name, quality_rating, status, messaging_limit_tier, name_status, platform_type, is_on_biz_app, last_synced_at from phone_numbers where meta_account_id = ${a.id} order by created_at limit 1`))[0] : undefined;
    const last = rows(await tx.execute(sql`select es_event, es_error, created_at from onboarding_sessions order by created_at desc limit 1`))[0];
    return {
      configured: connectConfigured(),
      sdk: connectConfigured() ? { appId: e.appId, configId: e.configId, version: e.version } : null,
      connection: a ? {
        wabaId: String(a.messaging_account_id), businessId: (a.business_id as string | null) ?? null, tokenStatus: String(a.token_status), health: String(a.health_state), payment: String(a.payment_method_status),
        mm: (a.mm_api_status as string | null) ?? null, subscribed: (a.subscribed_apps_ok as boolean | null) ?? null, checkedAt: a.token_checked_at ? new Date(String(a.token_checked_at)).toISOString() : null,
        phone: p ? { display: (p.display_phone_number as string | null) ?? null, verifiedName: (p.verified_name as string | null) ?? null, quality: (p.quality_rating as string | null) ?? null, status: (p.status as string | null) ?? null, tier: (p.messaging_limit_tier as string | null) ?? null, nameStatus: (p.name_status as string | null) ?? null, platform: (p.platform_type as string | null) ?? null, onBizApp: (p.is_on_biz_app as boolean | null) ?? null, syncedAt: p.last_synced_at ? new Date(String(p.last_synced_at)).toISOString() : null } : null,
      } : null,
      lastAttempt: last ? { event: (last.es_event as string | null) ?? null, error: last.es_error ? String((last.es_error as R).error_message ?? (last.es_error as R).message ?? 'Meta reported a problem') : null, at: new Date(String(last.created_at)).toISOString() } : null,
      canManage: ctx.role === 'owner' || ctx.role === 'admin',
    };
  });
}

/** Step 1: one onboarding record per attempt, so the popup's events and the code can be matched up. */
export async function startConnect(): Promise<Result<{ sessionId: string }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  if (!connectConfigured()) return fail('WhatsApp connection is not switched on for this installation yet.');
  return db(g.ctx, async (tx) => {
    const r = rows(await tx.execute(sql`insert into onboarding_sessions (tenant_id, path, es_version) values (${g.ctx.tenantId}, 'standard', 'v4') returning id`))[0]!;
    return { ok: true as const, data: { sessionId: String(r.id) } };
  });
}

/** Step 3: the raw message from the Meta window. Kept as-is, because the shapes vary by outcome. */
export async function recordSessionInfo(sessionId: string, event: string, data: unknown): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return fail('Bad session.');
  const safeEvent = String(event).slice(0, 60);
  const isError = safeEvent === 'ERROR', isCancel = safeEvent === 'CANCEL';
  return db(g.ctx, async (tx) => {
    await tx.execute(sql`update onboarding_sessions set es_event = ${safeEvent},
      session_info = case when ${!isError && !isCancel} then ${JSON.stringify(data ?? null)}::jsonb else session_info end,
      es_error = case when ${isError} then ${JSON.stringify(data ?? null)}::jsonb else es_error end,
      cancel_step = case when ${isCancel} then ${String(((data ?? {}) as R).current_step ?? '').slice(0, 60)} else cancel_step end
      where id = ${sessionId} and tenant_id = ${g.ctx.tenantId}`);
    return { ok: true as const, data: null };
  });
}

/**
 * Steps 4 to 11. The browser hands us the one-time code the moment the owner clicks Finish. Everything secret happens here.
 * The token is encrypted before it reaches the database, and the web role cannot read it back.
 */
export async function finishConnect(sessionId: string, code: string): Promise<Result<{ display: string | null; warnings: string[] }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  if (!connectConfigured()) return fail('WhatsApp connection is not switched on for this installation yet.');
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !code || code.length > 2000) return fail('Something went wrong with the sign-in. Please try again.');
  const e = env();

  const sess = await db(g.ctx, async (tx) => rows(await tx.execute(sql`select session_info, completed_at from onboarding_sessions where id = ${sessionId} and tenant_id = ${g.ctx.tenantId}`))[0]);
  if (!sess) return fail('That sign-in session was not found. Please start again.');
  if (sess.completed_at) return fail('That sign-in was already used. Please start again.');
  await db(g.ctx, (tx) => tx.execute(sql`update onboarding_sessions set code_received_at = now() where id = ${sessionId} and tenant_id = ${g.ctx.tenantId}`));

  const graph = new GraphClient({ graphVersion: e.version, baseUrl: e.baseUrl, appId: e.appId, appSecret: e.appSecret });
  let out;
  try { out = await completeSignup({ graph, code, sessionInfo: (sess.session_info as SessionInfo | null) ?? null, tokenKey: e.key }); }
  catch (err) {
    const msg = err instanceof SignupError ? err.userMessage : 'Something went wrong while connecting. Please try again.';
    await db(g.ctx, (tx) => tx.execute(sql`update onboarding_sessions set es_error = ${JSON.stringify({ error_message: msg, reason: err instanceof SignupError ? err.reason : 'unknown', code: err instanceof SignupError ? err.metaCode ?? null : null })}::jsonb where id = ${sessionId} and tenant_id = ${g.ctx.tenantId}`));
    return fail(msg);
  }

  return db(g.ctx, async (tx) => {
    try {
      await tx.execute(sql`select public.store_meta_connection(${out.businessId}, ${out.wabaId}, ${out.tokenEnc}, ${JSON.stringify(out.scopes)}::jsonb, ${out.phone.id}, ${out.phone.display}, ${out.phone.verifiedName}, ${out.pinEnc})`);
    } catch (err) {
      if (String((err as Error).message).includes('waba_in_use')) return fail('This WhatsApp account is already connected to another LeadBotCloud workspace.');
      throw err;
    }
    // Facts we just learned from Meta. The web role cannot write these tables, so the definer function above stores identity and this
    // narrow update goes through a second definer function for status fields.
    await tx.execute(sql`select public.update_meta_status(${out.phone.quality}, ${out.phone.status}, ${out.phone.throughput}, ${out.phone.nameStatus}, ${out.phone.platformType}, ${out.phone.accountMode}, ${out.phone.isOnBizApp}, ${out.phone.codeVerification}, ${out.registered}, ${out.mmStatus}, ${out.disableMarketingOnCloudApi}, true)`);
    await tx.execute(sql`update onboarding_sessions set completed_at = now(), token_exchanged_at = now() where id = ${sessionId} and tenant_id = ${g.ctx.tenantId}`);
    await audit(tx, 'meta.connect_finished', 'onboarding', sessionId, { phone_number_id: out.phone.id, registered: out.registered });
    revalidatePath('/settings'); revalidatePath('/dashboard');
    return { ok: true as const, data: { display: out.phone.display, warnings: out.warnings } };
  });
}

/** Removes our access. The owner can also remove the app inside Meta, which the webhook handles separately. */
export async function disconnect(): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    await tx.execute(sql`select public.disconnect_meta()`);
    await audit(tx, 'meta.disconnected', 'meta_account', g.ctx.tenantId, {});
    revalidatePath('/settings'); revalidatePath('/dashboard'); revalidatePath('/campaigns');
    return { ok: true as const, data: null };
  });
}

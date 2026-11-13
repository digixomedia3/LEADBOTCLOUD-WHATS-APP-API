import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { ConnectorError, SHOPIFY_TOPICS, cleanShop, hashState, newState, verifyShopifyQuery } from '@lbc/connectors';
import { decryptSecret, encryptSecret } from '@lbc/meta';
import { db, requireCtx, type Ctx } from '@/lib/session';
import { appBase, availability, google, isProvider, meta, redirectUri, shopify, tokenKey, workerBase, type Provider } from '@/lib/connectors';

export const dynamic = 'force-dynamic';
const back = (code: string, extra = '') => NextResponse.redirect(`${appBase()}/connections?${code.startsWith('ok') ? 'ok' : 'err'}=${code}${extra}`, 303);
type R = Record<string, unknown>;

async function consume(ctx: Ctx, state: string, provider: Provider): Promise<{ verifier: string | null; extra: R } | null> {
  const r = await db(ctx, async (tx) => ((await tx.execute(sql`select public.consume_oauth_state(${hashState(state)}, ${provider}) as s`)) as unknown as { s: { verifier: string | null; extra: R } | null }[])[0]?.s ?? null);
  return r;
}
const store = (ctx: Ctx, provider: Provider, external: string, label: string, access: string, refresh: string | null, expires: Date | null, scopes: string[], config: R = {}) =>
  db(ctx, (tx) => tx.execute(sql`select public.store_connection(${provider}, ${external}, ${label}, ${encryptSecret(access, tokenKey())}, ${refresh ? encryptSecret(refresh, tokenKey()) : null},
    ${expires ? expires.toISOString() : null}::timestamptz, (select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(scopes)}::jsonb) x), ${JSON.stringify(config)}::jsonb)`));

/** Where the provider sends the browser back. Nothing is trusted until the state is proven to belong to THIS user, this workspace, and to be unused. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return new NextResponse('Not found', { status: 404 });
  const ctx = await requireCtx();
  const q = req.nextUrl.searchParams;
  if (!availability()[provider].ready) return back('not_configured');
  if (q.get('error')) return back('denied');
  const code = q.get('code'), state = q.get('state');
  if (!code || !state) return back('state');

  try {
    if (provider === 'shopify') {
      if (!verifyShopifyQuery(q, process.env.SHOPIFY_CLIENT_SECRET ?? '')) return back('hmac');
      const shop = cleanShop(q.get('shop') ?? '');
      const st = await consume(ctx, state, provider);
      if (!st) return back('state');
      if (!shop || st.extra.shop !== shop) return back('shop');
      const sh = shopify()!;
      const tok = await sh.exchangeCode(shop, code);
      const info = await sh.shopInfo(shop, tok.accessToken);
      const hook = `${workerBase()}/webhooks/shopify`;
      for (const t of SHOPIFY_TOPICS) await sh.subscribe(shop, tok.accessToken, t, hook);
      await store(ctx, provider, shop, info.name || shop, tok.accessToken, null, null, tok.scopes);
      return back('ok_shopify');
    }

    const st = await consume(ctx, state, provider);
    if (!st) return back('state');

    if (provider === 'google_sheets') {
      const t = await google()!.exchangeCode(code, redirectUri(provider), decryptSecret(st.verifier ?? '', tokenKey()));
      if (!t.refreshToken) return back('no_refresh');
      if (!t.sub) return back('no_account');
      await store(ctx, provider, t.sub, t.email ?? 'Google account', t.accessToken, t.refreshToken, t.expiresAt, t.scopes);
      return back('ok_google');
    }

    // Facebook: the owner may manage many Pages, so let them choose. The Page tokens wait (encrypted) in a fresh single-use state.
    const m = meta()!;
    const short = await m.exchangeCode(code, redirectUri(provider));
    const long = await m.longLived(short.accessToken);
    const perms = await m.grantedPermissions(long.accessToken);
    if (!perms.granted.includes('leads_retrieval')) return back('perm');
    const pages = (await m.listPages(long.accessToken)).filter((p): p is typeof p & { access_token: string } => typeof p.access_token === 'string' && p.access_token.length > 0);
    if (pages.length === 0) return back('no_pages');
    const pick = newState();
    await db(ctx, (tx) => tx.execute(sql`insert into oauth_states (state_hash, tenant_id, user_id, provider, extra, expires_at)
      values (${hashState(pick)}, ${ctx.tenantId}, ${ctx.user.id}, 'meta_lead_ads', ${JSON.stringify({ pages: pages.map((p) => ({ id: p.id, name: p.name, token: encryptSecret(p.access_token, tokenKey()) })), scopes: perms.granted })}::jsonb, now() + interval '15 minutes')`));
    return NextResponse.redirect(`${appBase()}/connections?pick=${encodeURIComponent(pick)}`, 303);
  } catch (e) {
    if (e instanceof ConnectorError) {
      if (e.message.includes('connection_in_use')) return back('in_use');
      return back(e.retryable ? 'unreachable' : 'provider');
    }
    if ((e as Error).message?.includes('connection_in_use')) return back('in_use');
    if ((e as Error).message?.includes('owner or admin only')) return back('role');
    console.error('connect callback failed', provider, (e as Error).message);
    return back('failed');
  }
}

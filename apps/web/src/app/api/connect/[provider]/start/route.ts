import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { cleanShop, hashState, newPkce, newState } from '@lbc/connectors';
import { encryptSecret } from '@lbc/meta';
import { Forbidden, assertRole, db, requireCtx } from '@/lib/session';
import { appBase, availability, google, isProvider, meta, redirectUri, shopify, tokenKey } from '@/lib/connectors';

export const dynamic = 'force-dynamic';
const back = (code: string) => NextResponse.redirect(`${appBase()}/connections?err=${code}`, 303);

/** Starts a connection. Only owners and admins; the state is random, stored hashed, tied to this workspace AND this signed-in user, and valid for 10 minutes. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return new NextResponse('Not found', { status: 404 });
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return back('role'); throw e; }
  if (!availability()[provider].ready) return back('not_configured');

  const state = newState();
  let url: string; let verifier: string | null = null; const extra: Record<string, unknown> = {};
  if (provider === 'meta_lead_ads') url = meta()!.authorizeUrl(redirectUri(provider), state);
  else if (provider === 'shopify') {
    const shop = cleanShop(req.nextUrl.searchParams.get('shop') ?? '');
    if (!shop) return back('bad_shop');
    extra.shop = shop; url = shopify()!.authorizeUrl(shop, redirectUri(provider), state);
  } else {
    const p = newPkce(); verifier = encryptSecret(p.verifier, tokenKey()); url = google()!.authorizeUrl(redirectUri(provider), state, p.challenge);
  }
  await db(ctx, (tx) => tx.execute(sql`insert into oauth_states (state_hash, tenant_id, user_id, provider, verifier_enc, extra, expires_at)
    values (${hashState(state)}, ${ctx.tenantId}, ${ctx.user.id}, ${provider}, ${verifier}, ${JSON.stringify(extra)}::jsonb, now() + interval '10 minutes')`));
  return NextResponse.redirect(url, 303);
}

import 'server-only';
import { NextResponse } from 'next/server';
import type { ApiScope } from '@lbc/shared/api-keys';
import { authenticate, clientIdOf, need } from '@/lib/api-auth';
import { Forbidden, assertRole, type ActorCtx } from '@/lib/tenant-db';

/** JSON error in one shape every client can read: { error, code }. Never a stack trace, never an internal id. */
export function problem(status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

type Handler = (ctx: ActorCtx, req: Request, params: Record<string, string>) => Promise<Response>;

/**
 * Wraps a route: authenticates the key, checks the scope, then runs the handler.
 * Anything unexpected becomes a plain 500 with no details; the real error is logged on the server with the key prefix only.
 */
export function route(scope: ApiScope, handler: Handler) {
  return async (req: Request, { params }: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      const auth = await authenticate(req.headers, clientIdOf(req));
      if (!auth.ok) return problem(auth.status, auth.error, {}, auth.retryAfter ? { 'retry-after': String(auth.retryAfter) } : {});
      const allowed = need(auth, scope);
      if (!allowed.ok) return problem(allowed.status, allowed.error);
      return await handler(auth.ctx, req, await params);
    } catch (e) {
      if (e instanceof Forbidden) return problem(403, 'The person who created this key no longer has permission to do this.');
      console.error('[api] unexpected error', e instanceof Error ? e.message : 'unknown');
      return problem(500, 'Something went wrong on our side. Nothing was changed unless a result says so.');
    }
  };
}

export async function readJson(req: Request, maxBytes = 200_000): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) return { ok: false, res: problem(413, 'That request is too large.') };
  const text = await req.text();
  if (text.length > maxBytes) return { ok: false, res: problem(413, 'That request is too large.') };
  try { return { ok: true, body: text ? JSON.parse(text) : {} }; } catch { return { ok: false, res: problem(400, 'The body must be valid JSON.') }; }
}

export const okJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'cache-control': 'no-store' } });
void assertRole;

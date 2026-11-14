import 'server-only';
import { sql } from 'drizzle-orm';
import { withUser, type Role } from '@lbc/db';
import { RateLimiter, hasScope, hashApiKey, keyFromHeaders, type ApiScope } from '@lbc/shared/api-keys';
import { appDb, type ActorCtx } from '@/lib/tenant-db';

/**
 * Turns "Authorization: Bearer lbc_..." into an acting context, or a plain refusal.
 * The key resolves to its workspace and the person who made it, who must still be an owner or admin there.
 * Failed attempts are rate limited per client address so keys cannot be guessed.
 */
export type AuthResult = { ok: true; ctx: ActorCtx; scopes: string[] } | { ok: false; status: 401 | 403 | 429; error: string; retryAfter?: number };

const perKey = new RateLimiter(120, 60_000);   // 120 calls a minute per key
const badGuesses = new RateLimiter(20, 60_000); // 20 wrong keys a minute per address

/** Asks whether this address is already over its wrong-key budget WITHOUT counting this call. */
const overBudget = (clientId: string) => badGuesses.peek(`bad:${clientId}`);

interface Resolved { key_id: string; tenant_id: string; tenant_name: string; plan_id: string; scopes: string[]; send_cap_paise: number; user_id: string; user_name: string; role: string; prefix: string }

export async function authenticate(headers: Headers, clientId: string): Promise<AuthResult> {
  const wait = overBudget(clientId);
  if (wait > 0) return { ok: false, status: 429, error: 'Too many wrong keys from this address. Wait a minute.', retryAfter: wait };
  const key = keyFromHeaders((n) => headers.get(n));
  if (!key) { noteBadKey(clientId); return { ok: false, status: 401, error: 'Send your API key as "Authorization: Bearer lbc_...".' }; }
  const rows = (await withUser(appDb, '00000000-0000-0000-0000-000000000000', async (tx) => tx.execute(sql`select * from public.resolve_api_key(${hashApiKey(key)})`))) as unknown as Resolved[];
  const r = rows[0];
  if (!r) { noteBadKey(clientId); return { ok: false, status: 401, error: 'This API key is not valid. It may have been revoked or expired.' }; }
  const slow = perKey.check(r.key_id);
  if (slow > 0) return { ok: false, status: 429, error: 'Too many requests for this key. Slow down.', retryAfter: slow };
  const ctx: ActorCtx = {
    user: { id: r.user_id, name: r.user_name, email: '' },
    tenantId: r.tenant_id,
    workspace: { tenantId: r.tenant_id, name: r.tenant_name, role: r.role as Role, plan: r.plan_id },
    role: r.role as Role,
    via: { keyId: r.key_id, prefix: r.prefix, scopes: r.scopes, sendCapPaise: r.send_cap_paise },
  };
  return { ok: true, ctx, scopes: r.scopes };
}

/** Counts a wrong key against the caller's address. Called by the routes when authenticate() says 401. */
export function noteBadKey(clientId: string) { void badGuesses.check(`bad:${clientId}`); }

export function need(auth: Extract<AuthResult, { ok: true }>, scope: ApiScope): { ok: true } | { ok: false; status: 403; error: string } {
  return hasScope(auth.scopes, scope) ? { ok: true } : { ok: false, status: 403, error: `This key does not have the "${scope}" permission. Ask the workspace owner to create a key that does.` };
}

export function clientIdOf(req: Request): string {
  return (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim().slice(0, 64);
}

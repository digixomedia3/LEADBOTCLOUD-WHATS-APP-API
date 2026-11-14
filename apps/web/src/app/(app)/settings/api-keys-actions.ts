'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { apiKeys } from '@lbc/db';
import { generateApiKey } from '@lbc/shared/api-keys';
import { API_SCOPES, DEFAULT_SCOPES } from '@lbc/shared/api-scopes';
import { Forbidden, assertRole, audit, db, requireCtx } from '@/lib/session';

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export interface KeyRow { id: string; name: string; prefix: string; scopes: string[]; sendCapRupees: number; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revoked: boolean; createdByMe: boolean }

export async function listApiKeys(): Promise<KeyRow[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const rows = (await tx.execute(sql`select id, name, prefix, scopes, send_cap_paise, created_at, last_used_at, expires_at, revoked_at, created_by from api_keys order by created_at desc limit 100`)) as unknown as { id: string; name: string; prefix: string; scopes: string[]; send_cap_paise: number; created_at: Date; last_used_at: Date | null; expires_at: Date | null; revoked_at: Date | null; created_by: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes, sendCapRupees: r.send_cap_paise / 100, createdAt: new Date(r.created_at).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, revoked: !!r.revoked_at, createdByMe: r.created_by === ctx.user.id }));
  });
}

const createInput = z.object({
  name: z.string().trim().min(2, 'Give the key a name, for example “Claude”.').max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Choose at least one permission.').max(8),
  sendCapRupees: z.number().min(0).max(1_000_000).default(500),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90),
});

/** Only owners and admins can make keys, and a key is only ever as powerful as the person who made it. The key is returned once and never stored. */
export async function createApiKey(raw: z.input<typeof createInput>): Promise<Result<{ key: string; prefix: string }>> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return fail('Only the owner or an admin can create API keys.'); throw e; }
  const p = createInput.safeParse(raw);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  const d = p.data;
  if (d.scopes.includes('campaigns:send') && !d.scopes.includes('campaigns:write')) return fail('A key that can start sends also needs permission to create them.');
  return db(ctx, async (tx) => {
    const [{ n } = { n: 0 }] = (await tx.execute(sql`select count(*)::int n from api_keys where revoked_at is null`)) as unknown as { n: number }[];
    if (n >= 10) return fail('You have 10 active keys. Revoke one you no longer use first.');
    const k = generateApiKey();
    await tx.insert(apiKeys).values({
      tenantId: ctx.tenantId, name: d.name, prefix: k.prefix, keyHash: k.hash, scopes: d.scopes, sendCapPaise: Math.round(d.sendCapRupees * 100), createdBy: ctx.user.id,
      expiresAt: d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 86_400_000) : null,
    });
    await audit(tx, 'api_key.created', 'api_key', k.prefix, { name: d.name, scopes: d.scopes, sendCapRupees: d.sendCapRupees });
    revalidatePath('/settings');
    return { ok: true as const, data: { key: k.key, prefix: k.prefix } };
  });
}

export async function revokeApiKey(id: string): Promise<Result> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return fail('Only the owner or an admin can revoke API keys.'); throw e; }
  if (!z.string().uuid().safeParse(id).success) return fail('That key was not found.');
  return db(ctx, async (tx) => {
    const r = (await tx.execute(sql`update api_keys set revoked_at = now() where id = ${id}::uuid and revoked_at is null returning prefix`)) as unknown as { prefix: string }[];
    if (!r.length) return fail('That key was not found or is already revoked.');
    await audit(tx, 'api_key.revoked', 'api_key', r[0]!.prefix);
    revalidatePath('/settings');
    return { ok: true as const, data: null };
  });
}

export async function defaultScopes() { return DEFAULT_SCOPES; }

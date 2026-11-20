import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 5, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant-scoped data-access layer (layer 1 of isolation; RLS is layer 2).
 *
 * Every tenant query MUST go through this. It opens a transaction and sets
 * app.tenant_id / app.user_id with set_config(..., true), which is the
 * parameterised equivalent of SET LOCAL (transaction-scoped, reset on commit/rollback).
 * Callers must have verified membership already via `listMemberships` + role check;
 * this function additionally refuses a non-member when `userId` is given.
 */
export async function withTenant<T>(
  db: Db,
  ctx: { tenantId: string; userId?: string; /** The database itself refuses every write in this transaction. Used when platform staff view a customer's workspace. */ readOnly?: boolean },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(ctx.tenantId)) throw new Error('withTenant: tenantId must be a uuid');
  return db.transaction(async (tx) => {
    await tx.execute(
      sqlSet('app.tenant_id', ctx.tenantId),
    );
    await tx.execute(sqlSet('app.user_id', ctx.userId ?? ''));
    return fn(tx);
  }, ctx.readOnly ? { accessMode: 'read only' } : undefined);
}

/** Cross-tenant read of the caller's own memberships (workspace switcher). RLS limits rows to userId. */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId) throw new Error('withUser: userId required');
  return db.transaction(async (tx) => {
    await tx.execute(sqlSet('app.tenant_id', ''));
    await tx.execute(sqlSet('app.user_id', userId));
    return fn(tx);
  });
}

import { sql } from 'drizzle-orm';
function sqlSet(name: string, value: string) {
  return sql`select set_config(${name}, ${value}, true)`;
}

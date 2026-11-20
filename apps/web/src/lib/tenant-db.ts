/**
 * Database access for tenant code, with no Next.js request machinery, so the same functions run in the panel,
 * the API for AI agents, and plain tests. The `app` role only: row security is always enforced.
 */
import { sql } from 'drizzle-orm';
import { createDb, withTenant, type Role, type Tx } from '@lbc/db';

declare global {
  var __lbcAppDb: ReturnType<typeof createDb> | undefined;
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
export const appDb = (globalThis.__lbcAppDb ??= createDb(url, { max: 10 })).db;

/** Who is acting. For an API key, `via` says which key, so the audit trail can tell a person from an agent. */
export interface ActorCtx {
  user: { id: string; name: string; email: string };
  tenantId: string;
  workspace: { tenantId: string; name: string; role: Role; plan: string };
  role: Role;
  via?: { keyId: string; prefix: string; scopes: string[]; sendCapPaise: number };
  /** Platform staff looking at this workspace. Every transaction is read-only, enforced by the database. */
  readOnly?: boolean;
}

const RANK: Record<Role, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 };
export class Forbidden extends Error {
  constructor(public readonly need: Role) { super(`Requires ${need}`); }
}
export function assertRole(ctx: { role: Role }, min: Role) {
  if (RANK[ctx.role] < RANK[min]) throw new Forbidden(min);
}

/** Runs a tenant query inside a transaction with the tenant + user context set (row security layer 2). */
export function db<T>(ctx: Pick<ActorCtx, 'tenantId' | 'user' | 'readOnly'>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(appDb, { tenantId: ctx.tenantId, userId: ctx.user.id, readOnly: ctx.readOnly }, fn);
}

/** Append-only audit trail (the app role cannot INSERT into audit_log, only call this function). */
export async function audit(tx: Tx, action: string, entity: string, entityId?: string, after?: unknown) {
  await tx.execute(sql`select public.write_audit(${action}, ${entity}, ${entityId ?? ''}, ${after === undefined ? null : JSON.stringify(after)}::jsonb)`);
}

/** Same as audit(), but when an API key did it the action gets an `api.` prefix and the key is named, so agents are never mistaken for people. */
export function auditAs(tx: Tx, ctx: ActorCtx, action: string, entity: string, entityId?: string, after?: Record<string, unknown>) {
  return audit(tx, ctx.via ? `api.${action}` : action, entity, entityId, ctx.via ? { ...after, viaKey: ctx.via.prefix } : after);
}

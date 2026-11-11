import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, withTenant, withUser, tenants, tenantMembers, invitations, auditLog } from '../src';

// Isolation tests MUST run as the non-owner `app` role, otherwise RLS is bypassed and tests pass falsely.
const APP_URL = process.env.DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5433/leadbotcloud';
const WORKER_URL =
  process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud';

const app = createDb(APP_URL, { max: 3 });
const worker = createDb(WORKER_URL, { max: 3 });

const A = randomUUID();
const B = randomUUID();
const userA = `test-user-a-${A.slice(0, 8)}`;
const userB = `test-user-b-${B.slice(0, 8)}`;

beforeAll(async () => {
  // Seed through the worker (BYPASSRLS) role, as the real signup flow will.
  await worker.db.insert(tenants).values([
    { id: A, name: 'Tenant A' },
    { id: B, name: 'Tenant B' },
  ]);
  await worker.db.insert(tenantMembers).values([
    { tenantId: A, userId: userA, role: 'owner' },
    { tenantId: B, userId: userB, role: 'owner' },
  ]);
  await worker.db.insert(invitations).values([
    { tenantId: A, email: 'a@example.test', role: 'agent', tokenHash: `h-${A}`, invitedBy: userA, expiresAt: new Date(Date.now() + 86400000) },
    { tenantId: B, email: 'b@example.test', role: 'agent', tokenHash: `h-${B}`, invitedBy: userB, expiresAt: new Date(Date.now() + 86400000) },
  ]);
  await worker.db.insert(auditLog).values([
    { tenantId: A, actorType: 'system', action: 'test.a' },
    { tenantId: B, actorType: 'system', action: 'test.b' },
  ]);
});

afterAll(async () => {
  // audit_log is insert-only even for the worker, so clean up as the owner via a one-off connection.
  const owner = createDb(process.env.DATABASE_URL_MIGRATE ?? 'postgres://owner:owner_dev_password@localhost:5433/leadbotcloud', { max: 1 });
  await owner.client.unsafe(`delete from audit_log where tenant_id in ('${A}','${B}')`);
  await owner.client.unsafe(`delete from tenants where id in ('${A}','${B}')`);
  await owner.client.end();
  await app.client.end();
  await worker.client.end();
});

describe('role setup', () => {
  it('app role is not superuser, not BYPASSRLS, and owns no tables', async () => {
    const [r] = await app.client`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
    const owned = await app.client`select tablename from pg_tables where schemaname='public' and tableowner = current_user`;
    expect(owned).toHaveLength(0);
  });
  it('every tenant table has RLS enabled AND forced', async () => {
    const rows = await app.client`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname in ('tenants','tenant_members','invitations','audit_log')`;
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe('tenant isolation (as app role)', () => {
  it('sees nothing without tenant context', async () => {
    const rows = await app.db.select().from(invitations);
    expect(rows).toHaveLength(0);
  });

  it('tenant A reads only its own rows', async () => {
    await withTenant(app.db, { tenantId: A, userId: userA }, async (tx) => {
      expect((await tx.select().from(invitations)).map((r) => r.tenantId)).toEqual([A]);
      expect((await tx.select().from(tenantMembers)).every((m) => m.tenantId === A || m.userId === userA)).toBe(true);
      expect((await tx.select().from(auditLog)).every((l) => l.tenantId === A)).toBe(true);
      const t = await tx.select().from(tenants);
      expect(t.map((x) => x.id)).toEqual([A]);
    });
  });

  it('tenant A cannot insert a row for tenant B', async () => {
    await expect(
      withTenant(app.db, { tenantId: A, userId: userA }, (tx) =>
        tx.insert(invitations).values({ tenantId: B, email: 'x@example.test', role: 'agent', tokenHash: `evil-${A}`, invitedBy: userA, expiresAt: new Date(Date.now() + 1000) }),
      ),
    ).rejects.toThrow();
  });

  it('tenant A cannot update or delete tenant B rows (silently affects 0 rows)', async () => {
    await withTenant(app.db, { tenantId: A, userId: userA }, async (tx) => {
      const upd = await tx.update(invitations).set({ role: 'admin' }).where(sql`tenant_id = ${B}`).returning();
      expect(upd).toHaveLength(0);
      const del = await tx.delete(invitations).where(sql`tenant_id = ${B}`).returning();
      expect(del).toHaveLength(0);
      const upT = await tx.update(tenants).set({ name: 'hacked' }).where(sql`id = ${B}`).returning();
      expect(upT).toHaveLength(0);
    });
    const [still] = await worker.db.select().from(invitations).where(sql`tenant_id = ${B}`);
    expect(still?.role).toBe('agent');
  });

  it('setting tenant_id does not leak after the transaction ends', async () => {
    await withTenant(app.db, { tenantId: A }, async () => {});
    const rows = await app.db.select().from(invitations);
    expect(rows).toHaveLength(0);
  });

  it('a user sees only their own memberships across workspaces (switcher)', async () => {
    await withUser(app.db, userA, async (tx) => {
      const m = await tx.select().from(tenantMembers);
      expect(m.map((x) => x.userId)).toEqual([userA]);
    });
  });

  it('app role cannot create or delete tenants', async () => {
    await expect(
      withTenant(app.db, { tenantId: A }, (tx) => tx.insert(tenants).values({ name: 'rogue' })),
    ).rejects.toThrow();
    await expect(withTenant(app.db, { tenantId: A }, (tx) => tx.delete(tenants))).rejects.toThrow();
  });

  it('audit_log is insert-only: app cannot write, and worker cannot update or delete', async () => {
    await expect(
      withTenant(app.db, { tenantId: A }, (tx) => tx.insert(auditLog).values({ tenantId: A, actorType: 'user', action: 'x' })),
    ).rejects.toThrow();
    await expect(worker.db.update(auditLog).set({ action: 'tamper' }).where(sql`tenant_id = ${A}`)).rejects.toThrow();
    await expect(worker.db.delete(auditLog).where(sql`tenant_id = ${A}`)).rejects.toThrow();
  });

  it('rejects a non-uuid tenant id before touching the database', async () => {
    await expect(withTenant(app.db, { tenantId: "x'; drop table tenants;--" }, async () => {})).rejects.toThrow(/uuid/);
  });
});

describe('worker role', () => {
  it('bypasses RLS and sees both tenants', async () => {
    const rows = await worker.db.select().from(invitations).where(sql`tenant_id in (${A}, ${B})`);
    expect(rows).toHaveLength(2);
  });
});

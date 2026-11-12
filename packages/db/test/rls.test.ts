import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, withTenant, withUser, tenants, tenantMembers, invitations, auditLog, user, contacts, contactGroups, contactGroupMembers, contactConsentEvents, templates, campaigns, conversations, messages, automationRules, renewals, quickReplies } from '../src';

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
  await worker.db.insert(user).values([
    { id: userA, name: 'User A', email: `${userA}@example.test` },
    { id: userB, name: 'User B', email: `${userB}@example.test` },
  ]);
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
  // Tenants cascade to every tenant-owned child table; audit_log has no cascade, so clear it first.
  // Teardown uses the dev superuser: FORCE RLS leaves the owner insert-only on audit_log, by design.
  const owner = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud', { max: 1 });
  const testTenants = `select id from tenants where id in ('${A}','${B}') or name like 'WS Test %'`;
  await owner.client.unsafe(`delete from audit_log where tenant_id in (${testTenants})`);
  await owner.client.unsafe(`delete from tenants where id in (${testTenants})`);
  await owner.client.unsafe(`delete from "user" where id in ('${userA}','${userB}') or email like 'ws-test-%@example.test'`);
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

describe('contacts, groups and consent (as app role)', () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const rows = await worker.db.insert(contacts).values([
      { tenantId: A, phoneE164: '+919000000001', name: 'A contact' },
      { tenantId: B, phoneE164: '+919000000001', name: 'B contact (same phone, other tenant)' },
    ]).returning();
    ids.cA = rows.find((r) => r.tenantId === A)!.id;
    ids.cB = rows.find((r) => r.tenantId === B)!.id;
    const [g] = await worker.db.insert(contactGroups).values({ tenantId: B, name: 'B group' }).returning();
    ids.gB = g!.id;
    await worker.db.insert(contactGroupMembers).values({ tenantId: B, groupId: ids.gB, contactId: ids.cB });
    await worker.db.insert(contactConsentEvents).values({ tenantId: A, contactId: ids.cA, action: 'opt_in', source: 'Website form' });
  });

  it('the same phone number can exist in two tenants without clashing', async () => {
    await withTenant(app.db, { tenantId: A }, async (tx) => {
      const r = await tx.select().from(contacts);
      expect(r.map((x) => x.name)).toEqual(['A contact']);
    });
  });
  it('tenant A cannot see or touch tenant B contacts, groups or members', async () => {
    await withTenant(app.db, { tenantId: A }, async (tx) => {
      expect(await tx.select().from(contactGroups)).toHaveLength(0);
      expect(await tx.select().from(contactGroupMembers)).toHaveLength(0);
      const upd = await tx.update(contacts).set({ name: 'hacked' }).where(sql`id = ${ids.cB}`).returning();
      expect(upd).toHaveLength(0);
      const del = await tx.delete(contacts).where(sql`id = ${ids.cB}`).returning();
      expect(del).toHaveLength(0);
    });
    const [still] = await worker.db.select().from(contacts).where(sql`id = ${ids.cB}`);
    expect(still?.name).toMatch(/B contact/);
  });
  it('tenant A cannot add its contact to tenant B group, or write contacts for B', async () => {
    await expect(withTenant(app.db, { tenantId: A }, (tx) => tx.insert(contactGroupMembers).values({ tenantId: B, groupId: ids.gB, contactId: ids.cA }))).rejects.toThrow();
    await expect(withTenant(app.db, { tenantId: A }, (tx) => tx.insert(contacts).values({ tenantId: B, phoneE164: '+919000000002' }))).rejects.toThrow();
  });
  it('consent events are readable by their tenant, hidden from others, and cannot be edited or deleted', async () => {
    await withTenant(app.db, { tenantId: A }, async (tx) => {
      expect(await tx.select().from(contactConsentEvents)).toHaveLength(1);
    });
    await withTenant(app.db, { tenantId: B }, async (tx) => {
      expect(await tx.select().from(contactConsentEvents)).toHaveLength(0);
    });
    await expect(withTenant(app.db, { tenantId: A }, (tx) => tx.update(contactConsentEvents).set({ source: 'x' }))).rejects.toThrow();
    await expect(withTenant(app.db, { tenantId: A }, (tx) => tx.delete(contactConsentEvents))).rejects.toThrow();
    await expect(worker.db.update(contactConsentEvents).set({ source: 'x' })).rejects.toThrow();
  });
});

describe('create_workspace (signup)', () => {
  const email = `ws-test-${Date.now()}@example.test`;
  const uid = `ws-test-user-${Date.now()}`;
  beforeAll(async () => {
    await worker.db.insert(user).values({ id: uid, name: 'WS Test', email });
  });

  it('creates tenant + owner membership + audit row atomically', async () => {
    const id = await app.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${uid}, true)`);
      const r = await tx.execute(sql`select public.create_workspace(${uid}, ${'WS Test One'}, ${'retail'}, ${'none'}, ${'2026-11-11'}) as id`);
      return (r as unknown as { id: string }[])[0]!.id;
    });
    const m = await worker.db.select().from(tenantMembers).where(sql`tenant_id = ${id}`);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ userId: uid, role: 'owner' });
    const a = await worker.db.select().from(auditLog).where(sql`tenant_id = ${id}`);
    expect(a.some((x) => x.action === 'workspace.created')).toBe(true);
    await withUser(app.db, uid, async (tx) => {
      expect((await tx.select().from(tenants)).map((t) => t.id)).toContain(id);
    });
  });
  it('refuses to create a workspace for someone else', async () => {
    await expect(
      app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${userA}, true)`);
        await tx.execute(sql`select public.create_workspace(${uid}, ${'WS Test Evil'}, ${'retail'}, ${'none'}, ${'x'})`);
      }),
    ).rejects.toThrow();
  });
  it('refuses with no user context, unknown users and bad input', async () => {
    await expect(app.db.execute(sql`select public.create_workspace(${uid}, ${'WS Test No Ctx'}, ${'retail'}, ${'none'}, ${'x'})`)).rejects.toThrow();
    await expect(
      app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${'ghost'}, true)`);
        await tx.execute(sql`select public.create_workspace(${'ghost'}, ${'WS Test Ghost'}, ${'retail'}, ${'none'}, ${'x'})`);
      }),
    ).rejects.toThrow();
    await expect(
      app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${uid}, true)`);
        await tx.execute(sql`select public.create_workspace(${uid}, ${'x'}, ${'retail'}, ${'none'}, ${'x'})`);
      }),
    ).rejects.toThrow();
  });
  it('app role still cannot insert tenants directly', async () => {
    await expect(app.db.insert(tenants).values({ name: 'WS Test Direct' })).rejects.toThrow();
  });
});

describe('templates, campaigns, chats, rules, renewals (as app role)', () => {
  it('tenant A sees none of tenant B rows in any module table, and cannot write into B', async () => {
    const [c] = await worker.db.insert(contacts).values({ tenantId: B, phoneE164: '+919****0099', name: 'B cust' }).returning();
    const [t] = await worker.db.insert(templates).values({ tenantId: B, name: 'b_offer', category: 'marketing', body: 'Hello' }).returning();
    await worker.db.insert(campaigns).values({ tenantId: B, name: 'B campaign', templateId: t!.id });
    const [cv] = await worker.db.insert(conversations).values({ tenantId: B, contactId: c!.id }).returning();
    await worker.db.insert(messages).values({ tenantId: B, conversationId: cv!.id, direction: 'in', body: 'secret' });
    await worker.db.insert(automationRules).values({ tenantId: B, name: 'r', reply: 'x' });
    await worker.db.insert(quickReplies).values({ tenantId: B, shortcut: 'hi', body: 'x' });
    await worker.db.insert(renewals).values({ tenantId: B, contactId: c!.id, planName: 'Gym', amountPaise: 50000, dueOn: '2026-12-01' });

    await withTenant(app.db, { tenantId: A }, async (tx) => {
      for (const tbl of [templates, campaigns, conversations, messages, automationRules, quickReplies, renewals]) {
        expect(await tx.select().from(tbl)).toHaveLength(0);
      }
      await expect(tx.transaction(async (sp) => { await sp.insert(templates).values({ tenantId: B, name: 'x', category: 'utility', body: 'x' }); })).rejects.toThrow(/row-level security/);
    });
    await withTenant(app.db, { tenantId: B }, async (tx) => {
      expect(await tx.select().from(messages)).toHaveLength(1);
    });
  });
  it('rejects invalid category, status and negative amounts at the database', async () => {
    await withTenant(app.db, { tenantId: A }, async (tx) => {
      await expect(tx.transaction(async (sp) => { await sp.execute(sql`insert into templates (tenant_id,name,category,body) values (${A},'bad','nonsense','x')`); })).rejects.toThrow(/check constraint/);
    });
  });
});


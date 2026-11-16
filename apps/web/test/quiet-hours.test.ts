import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));
let role: 'owner' | 'admin' | 'agent' | 'viewer' = 'owner';
let tenant = '', user = '';
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, requireCtx: async () => ({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role, plan: 'pro' }, role, workspaces: [] }) };
});
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');

describe('quiet hours settings and campaign speed', () => {
  let sql: postgres.Sql; let tpl = '', grp = '';
  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 });
    tenant = randomUUID(); user = `qs-${randomUUID().slice(0, 8)}`; role = 'owner';
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${'QS ' + user})`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    tpl = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'qs_t', 'en', 'marketing', 'approved', 'hello there friend', '[]') returning id`)[0]!.id;
    grp = (await sql`insert into contact_groups (tenant_id, name) values (${tenant}, 'g') returning id`)[0]!.id;
    const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${tenant}, '+919900088888', 'P', 'allowed') returning id`)[0]!.id;
    await sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${tenant}, ${grp}, ${c})`;
  });
  afterAll(async () => { await sql`delete from audit_log where tenant_id = ${tenant}`; await sql`delete from tenants where id = ${tenant}`; await sql`delete from "user" where id = ${user}`; await sql.end(); });
  const row = async () => (await sql`select quiet_hours_enabled e, quiet_start_hour s, quiet_end_hour d from tenants where id = ${tenant}`)[0]!;

  it('a new workspace starts with quiet hours on, 9 pm to 9 am', async () => {
    const { loadQuiet } = await import('../src/app/(app)/settings/actions');
    expect(await loadQuiet()).toMatchObject({ enabled: true, startHour: 21, endHour: 9, timezone: 'Asia/Kolkata' });
  });
  it('an owner and an admin can change them, and it is logged', async () => {
    const { saveQuiet, loadQuiet } = await import('../src/app/(app)/settings/actions');
    for (const r of ['owner', 'admin'] as const) { role = r; expect((await saveQuiet({ enabled: true, startHour: 22, endHour: 8 })).ok, r).toBe(true); }
    expect(await loadQuiet()).toMatchObject({ startHour: 22, endHour: 8 });
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'workspace.quiet_hours'`)[0]!.n)).toBe(2);
    role = 'owner';
  });
  it('an agent and a viewer cannot, and nothing changes', async () => {
    const { saveQuiet } = await import('../src/app/(app)/settings/actions'); const before = await row();
    for (const r of ['agent', 'viewer'] as const) { role = r; const x = await saveQuiet({ enabled: false, startHour: 1, endHour: 2 }); expect(x.ok, r).toBe(false); }
    expect(await row()).toEqual(before); role = 'owner';
  });
  it('refuses nonsense with a plain reason and changes nothing', async () => {
    const { saveQuiet } = await import('../src/app/(app)/settings/actions'); const before = await row();
    for (const bad of [{ startHour: 25, endHour: 9 }, { startHour: 9, endHour: 9 }, { startHour: 1, endHour: 20 }, { startHour: -1, endHour: 5 }, { startHour: 1.5, endHour: 5 }, { startHour: Number.NaN, endHour: 5 }]) {
      const x = await saveQuiet({ enabled: true, ...bad }); expect(x.ok, JSON.stringify(bad)).toBe(false); expect(!x.ok && x.error.length > 10).toBe(true);
    }
    expect(await row()).toEqual(before);
  });
  it('switching them off keeps the hours but stops holding', async () => {
    const { saveQuiet } = await import('../src/app/(app)/settings/actions');
    expect((await saveQuiet({ enabled: false, startHour: 22, endHour: 8 })).ok).toBe(true); expect(await row()).toMatchObject({ e: false, s: 22, d: 8 });
  });
  it('one workspace cannot change another\'s', async () => {
    const other = randomUUID(); await sql`insert into tenants (id, name) values (${other}, ${'QS other ' + other.slice(0, 6)})`;
    try {
      const { saveQuiet } = await import('../src/app/(app)/settings/actions'); await saveQuiet({ enabled: true, startHour: 20, endHour: 6 });
      expect((await sql`select quiet_start_hour s from tenants where id = ${other}`)[0]!.s).toBe(21);
    } finally { await sql`delete from tenants where id = ${other}`; }
  });

  const make = async (sendPerMinute?: number) => {
    const { createCampaignFor } = await import('@/lib/core/campaigns');
    return createCampaignFor({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role: 'owner', plan: 'pro' }, role: 'owner' }, { name: 'Speed ' + Math.random().toString(36).slice(2, 7), templateId: tpl, groupIds: [grp], when: 'later', scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), varMap: [], sendPerMinute });
  };
  it('a campaign stores its speed; none or 0 means as fast as possible', async () => {
    const a = await make(120), b = await make(), c = await make(0);
    for (const [r, want] of [[a, 120], [b, null], [c, null]] as const) { expect(r.ok).toBe(true); if (r.ok) expect((await sql`select send_per_minute s from campaigns where id = ${r.data.id}`)[0]!.s).toBe(want); }
  });
  it('refuses a silly speed', async () => { for (const bad of [-1, 6001, 1.5]) { const r = await make(bad); expect(r.ok, String(bad)).toBe(false); } });
});

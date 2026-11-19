import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
let signedIn: string | null = null;
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, getSession: async () => (signedIn ? { user: { id: signedIn, name: 'N', email: signedIn + '@example.com' } } : null) };
});
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
const mk = () => randomUUID().slice(0, 8);

describe('super admin panel', () => {
  let sql: postgres.Sql; let app: postgres.Sql;
  let staff = '', plain = '', t1 = '', t2 = '', camp = '', journey = '', tag = '';
  const A = () => import('../src/app/(admin)/admin/actions');
  /** Runs SQL as the real `app` role with a given signed-in user, exactly like the web server does. */
  const asApp = async <T,>(userId: string, q: (tx: postgres.TransactionSql) => Promise<T>) => app.begin(async (tx) => { await tx`select set_config('app.tenant_id', '', true), set_config('app.user_id', ${userId}, true)`; return q(tx); }) as Promise<T>;

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 }); app = postgres(process.env.DATABASE_URL!, { max: 2 });
    tag = mk(); staff = `sa-${tag}`; plain = `sp-${tag}`; t1 = randomUUID(); t2 = randomUUID();
    for (const u of [staff, plain]) await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, ${u}, ${u + '@example.com'}, true, now(), now())`;
    await sql`insert into platform_admins (user_id) values (${staff})`;
    await sql`update "user" set two_factor_enabled = true where id = ${staff}`;      // staff must have two-step sign-in on, or the panel stays closed
    await sql`insert into tenants (id, name, plan_id, status) values (${t1}, ${'Zed Traders ' + tag}, 'starter', 'ready')`;
    await sql`insert into tenants (id, name, plan_id, status) values (${t2}, ${'Other ' + tag}, 'free', 'onboarding')`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${t1}, ${plain}, 'owner')`;
    camp = (await sql`insert into campaigns (tenant_id, name, status) values (${t1}, 'Live one', 'running') returning id`)[0]!.id;
    await sql`insert into campaigns (tenant_id, name, status) values (${t1}, 'Done one', 'completed')`;
    journey = (await sql`insert into journeys (tenant_id, name, status, trigger, steps) values (${t1}, 'Welcome', 'active', '{"type":"manual"}', '[]') returning id`)[0]!.id;
  });
  afterAll(async () => {
    await sql`delete from announcements where message like ${'%' + tag + '%'}`;
    await sql`delete from audit_log where tenant_id in (${t1}, ${t2}) or actor_user_id in (${staff}, ${plain})`;   // the log is append-only for the app, but this is the test owner
    await sql`delete from tenants where id in (${t1}, ${t2})`; await sql`delete from "user" where id in (${staff}, ${plain})`;
    await sql.end(); await app.end();
  });

  it('shows nothing to people who are not staff: signed out, or signed in as a normal customer', async () => {
    const a = await A();
    signedIn = null; await expect(a.loadOverview()).rejects.toThrow('NEXT_NOT_FOUND');
    signedIn = plain;
    await expect(a.loadOverview()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(a.loadTenants('', '', 1)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(a.setSuspended(t1, true, 'because reasons')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(a.setPlan(t1, 'pro', '')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(a.announce('hello everyone ' + tag, 'info', 1)).rejects.toThrow('NEXT_NOT_FOUND');
    const [{ status }] = await sql`select status from tenants where id = ${t1}`; expect(status).toBe('ready');
  });

  it('refuses at the database even when the app layer is bypassed', async () => {
    for (const q of [(tx: postgres.TransactionSql) => tx`select admin_overview()`, (tx: postgres.TransactionSql) => tx`select admin_set_plan(${t1}::uuid, 'pro', '')`, (tx: postgres.TransactionSql) => tx`select admin_set_suspended(${t1}::uuid, true, 'sneaky attempt')`, (tx: postgres.TransactionSql) => tx`select admin_announce(${'sneaky ' + tag}, 'info', 1)`])
      await expect(asApp(plain, q)).rejects.toMatchObject({ code: '42501' });
    await expect(asApp('', (tx) => tx`select admin_overview()`)).rejects.toMatchObject({ code: '42501' });
    await expect(asApp(plain, (tx) => tx`select admin_guard()`)).rejects.toMatchObject({ code: '42501' });     // the internal helper is not callable at all
    expect((await sql`select plan_id from tenants where id = ${t1}`)[0]!.plan_id).toBe('starter');
  });

  it('nobody can make themselves staff, and staff cannot see who else is staff', async () => {
    await expect(asApp(plain, (tx) => tx`insert into platform_admins (user_id) values (${plain})`)).rejects.toThrow();
    await expect(asApp(staff, (tx) => tx`insert into platform_admins (user_id) values (${plain})`)).rejects.toThrow();
    await expect(asApp(staff, (tx) => tx`delete from platform_admins where user_id = ${staff}`)).rejects.toThrow();
    expect((await asApp(plain, (tx) => tx`select user_id from platform_admins`)).length).toBe(0);
    expect((await asApp(staff, (tx) => tx`select user_id from platform_admins`)).map((r) => r.user_id)).toEqual([staff]);   // only their own row
  });

  it('staff see platform numbers and can search workspaces by name, owner email or id', async () => {
    signedIn = staff; const a = await A();
    const o = await a.loadOverview(); expect(o.ok).toBe(true); if (o.ok) { expect(o.data.users).toBeGreaterThanOrEqual(2); expect(o.data.tenants.ready).toBeGreaterThanOrEqual(1); }
    for (const q of ['Zed Traders ' + tag, plain + '@example', t1]) { const r = await a.loadTenants(q, '', 1); expect(r.ok && r.data.rows.map((x) => x.id)).toEqual([t1]); }
    const r = await a.loadTenants('', 'onboarding', 1); expect(r.ok && r.data.rows.some((x) => x.id === t2)).toBe(true); expect(r.ok && r.data.rows.every((x) => x.status === 'onboarding')).toBe(true);
    const wild = await a.loadTenants('%', '', 1); expect(wild.ok && wild.data.total).toBe(0);                    // a % is not "match everything"
    const row = (await a.loadTenants(t1, '', 1)); expect(row.ok && row.data.rows[0]).toMatchObject({ owner: plain + '@example.com', members: 1 });
  });

  it('viewing a workspace shows its details and is itself logged', async () => {
    signedIn = staff; const a = await A();
    const d = await a.loadTenant(t1); expect(d.ok && d.data?.name).toBe('Zed Traders ' + tag); expect(d.ok && d.data?.members[0]?.email).toBe(plain + '@example.com');
    expect((await a.loadTenant('not-a-uuid')) as unknown).toEqual({ ok: true, data: null });
    expect((await a.loadTenant(randomUUID())) as unknown).toEqual({ ok: true, data: null });
    const [l] = await sql`select actor_user_id, actor_type from audit_log where tenant_id = ${t1} and action = 'admin.viewed_workspace' order by id desc limit 1`;
    expect(l).toMatchObject({ actor_user_id: staff, actor_type: 'super_admin' });
  });

  it('changes plan and review, validates input, and records who did it', async () => {
    signedIn = staff; const a = await A();
    expect((await a.setPlan(t1, 'pro', 'goodwill ' + tag)).ok).toBe(true);
    expect((await sql`select plan_id from tenants where id = ${t1}`)[0]!.plan_id).toBe('pro');
    expect(await a.setPlan(t1, 'pro', '')).toMatchObject({ ok: true, data: { changed: false } });
    expect(await a.setPlan(t1, 'platinum', '')).toMatchObject({ ok: false });
    expect(await a.setPlan(randomUUID(), 'pro', '')).toMatchObject({ ok: false });
    expect((await a.setReview(t1, 'flagged')).ok).toBe(true); expect(await a.setReview(t1, 'nonsense')).toMatchObject({ ok: false });
    const [l] = await sql`select actor_user_id, after from audit_log where tenant_id = ${t1} and action = 'admin.plan_changed'`;
    expect(l!.actor_user_id).toBe(staff); expect(l!.after).toMatchObject({ from: 'starter', to: 'pro' });
  });

  it('suspends: needs a reason, pauses sending, blocks starting a campaign, and reactivating restores without restarting', async () => {
    signedIn = staff; const a = await A();
    expect(await a.setSuspended(t1, true, '')).toMatchObject({ ok: false });
    expect(await a.setSuspended(t1, true, 'abc')).toMatchObject({ ok: false });
    expect((await sql`select status from tenants where id = ${t1}`)[0]!.status).toBe('ready');
    const r = await a.setSuspended(t1, true, 'spam complaints ' + tag);
    expect(r).toMatchObject({ ok: true, data: { changed: true, campaignsPaused: 1, journeysPaused: 1 } });
    const [t] = await sql`select status, suspended_from, suspended_reason from tenants where id = ${t1}`; expect(t).toMatchObject({ status: 'suspended', suspended_from: 'ready' }); expect(t!.suspended_reason).toContain('spam');
    expect((await sql`select status from campaigns where id = ${camp}`)[0]!.status).toBe('paused');
    expect((await sql`select status from campaigns where tenant_id = ${t1} and name = 'Done one'`)[0]!.status).toBe('completed');     // finished ones are left alone
    expect((await sql`select status from journeys where id = ${journey}`)[0]!.status).toBe('paused');
    // starting a send from the panel or an API key is refused up front
    const { queueCampaignFor } = await import('../src/lib/core/campaigns');
    const q = await queueCampaignFor({ user: { id: plain, name: 'n', email: '' }, tenantId: t1, workspace: { tenantId: t1, name: 'x', role: 'owner', plan: 'pro' }, role: 'owner' }, camp);
    expect(q).toMatchObject({ ok: false }); expect((await sql`select status from campaigns where id = ${camp}`)[0]!.status).toBe('paused');
    expect(await a.setSuspended(t1, true, 'again, for the record')).toMatchObject({ ok: true, data: { changed: false } });     // twice changes nothing
    // reactivate
    expect(await a.setSuspended(t1, false, '')).toMatchObject({ ok: true, data: { changed: true } });
    const [t2r] = await sql`select status, suspended_from, suspended_reason, suspended_at from tenants where id = ${t1}`; expect(t2r).toMatchObject({ status: 'ready', suspended_from: null, suspended_reason: null, suspended_at: null });
    expect((await sql`select status from campaigns where id = ${camp}`)[0]!.status).toBe('paused');     // the owner decides when to restart
    expect((await sql`select status from journeys where id = ${journey}`)[0]!.status).toBe('paused');
    expect(await a.setSuspended(t1, false, '')).toMatchObject({ ok: true, data: { changed: false } });
    const acts = (await sql`select action from audit_log where tenant_id = ${t1} and action like 'admin.%' and actor_type = 'super_admin'`).map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(['admin.suspended', 'admin.reactivated']));
  });

  it('will not suspend a workspace that has left', async () => {
    signedIn = staff; const a = await A();
    await sql`update tenants set status = 'offboarded' where id = ${t2}`;
    expect(await a.setSuspended(t2, true, 'should not work here')).toMatchObject({ ok: false });
    expect((await sql`select status from tenants where id = ${t2}`)[0]!.status).toBe('offboarded');
  });

  it('announcements: validated, visible to every customer while live, gone once ended or expired, and customers cannot write them', async () => {
    signedIn = staff; const a = await A();
    expect(await a.announce('no', 'info', 1)).toMatchObject({ ok: false });
    expect(await a.announce('x'.repeat(301), 'info', 1)).toMatchObject({ ok: false });
    expect(await a.announce('fine message ' + tag, 'scary', 1)).toMatchObject({ ok: false });
    expect(await a.announce('fine message ' + tag, 'info', 0)).toMatchObject({ ok: false });
    const made = await a.announce('Maintenance tonight ' + tag, 'warning', 2); expect(made.ok).toBe(true); const id = made.ok ? made.data.id : '';
    const seen = async () => (await asApp(plain, (tx) => tx`select id from announcements`)).map((r) => r.id);
    expect(await seen()).toContain(id);
    await expect(asApp(plain, (tx) => tx`insert into announcements (message) values ('hijack')`)).rejects.toThrow();
    await expect(asApp(plain, (tx) => tx`update announcements set active = true`)).rejects.toThrow();
    expect(await a.endAnnouncement(id)).toMatchObject({ ok: true, data: { ended: true } });
    expect(await seen()).not.toContain(id);
    expect(await a.endAnnouncement(id)).toMatchObject({ ok: true, data: { ended: false } });
    const id2 = (await sql`insert into announcements (message, ends_at) values (${'old news ' + tag}, now() - interval '1 minute') returning id`)[0]!.id;
    expect(await seen()).not.toContain(id2);
  });

  it('audit log: newest first, pages, filters by workspace and action, and an invalid filter is ignored', async () => {
    signedIn = staff; const a = await A();
    const all = await a.loadAudit(null, '', ''); expect(all.ok && all.data.length).toBeGreaterThan(0);
    if (all.ok) { const ids = all.data.map((x) => x.id); expect([...ids].sort((x, y) => y - x)).toEqual(ids); }
    const mine = await a.loadAudit(null, t1, 'admin.'); expect(mine.ok && mine.data.every((x) => x.tenantId === t1 && x.action.startsWith('admin.'))).toBe(true);
    const last = mine.ok ? mine.data[mine.data.length - 1]!.id : 0;
    const older = await a.loadAudit(last, t1, 'admin.'); expect(older.ok && older.data.every((x) => x.id < last)).toBe(true);
    const odd = await a.loadAudit(null, 'junk', '%'); expect(odd.ok).toBe(true);
  });
});

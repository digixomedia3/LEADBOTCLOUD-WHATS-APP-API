import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/**
 * Read-only "view as customer" for platform staff. Runs the REAL session code, the real admin actions and the real database functions as the `app` role;
 * only the sign-in lookup and the cookie jar are faked.
 */
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
let signedIn: string | null = null;
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => (signedIn ? { user: { id: signedIn, name: 'N ' + signedIn, email: signedIn + '@example.com' } } : null) } } }));
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { value: jar.get(n)! } : undefined), set: (n: string, v: string) => { jar.set(n, v); }, delete: (n: string) => { jar.delete(n); } }),
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error('REDIRECT ' + to); } }));
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');

describe('staff read-only view of a customer workspace', () => {
  const tag = randomUUID().slice(0, 8);
  const staff = `vw-${tag}-s`, staff2 = `vw-${tag}-s2`, noTf = `vw-${tag}-n`, owner = `vw-${tag}-o`, stranger = `vw-${tag}-x`, customer2fa = `vw-${tag}-c`;
  const T1 = randomUUID(), T2 = randomUUID(), T3 = randomUUID();
  let sql: postgres.Sql; let app: postgres.Sql; let contact = '', conv = '';
  const asApp = async <T,>(userId: string, q: (tx: postgres.TransactionSql) => Promise<T>) => app.begin(async (tx) => { await tx`select set_config('app.tenant_id', '', true), set_config('app.user_id', ${userId}, true)`; return q(tx); }) as Promise<T>;
  const start = (u: string, t: string, reason = 'Support ticket 4821: campaign stuck') => asApp(u, async (tx) => (await tx`select public.admin_view_start(${t}::uuid, ${reason}) as v`)[0]!.v as { id: string; tenantId: string; tenantName: string; expiresAt: string });
  const get = (u: string, id: string) => asApp(u, async (tx) => (await tx`select public.admin_view_get(${id}::uuid) as v`)[0]!.v as { tenantId: string } | null);
  const A = () => import('../src/app/(admin)/admin/actions');
  const S = () => import('../src/lib/session');
  const T = () => import('../src/lib/tenant-db');
  const audit = (t: string, action: string) => sql`select actor_user_id, actor_type, after from audit_log where tenant_id = ${t} and action = ${action} order by id`;

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 }); app = postgres(process.env.DATABASE_URL!, { max: 4 });
    for (const u of [staff, staff2, noTf, owner, stranger, customer2fa]) await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, ${u}, ${u + '@example.com'}, true, now(), now())`;
    for (const u of [staff, staff2]) { await sql`insert into platform_admins (user_id) values (${u})`; await sql`update "user" set two_factor_enabled = true where id = ${u}`; }
    await sql`update "user" set two_factor_enabled = true where id = ${customer2fa}`;       // an ordinary customer who happens to use two-step sign-in
    await sql`insert into platform_admins (user_id) values (${noTf})`;       // staff, but without two-step sign-in
    await sql`insert into tenants (id, name, plan_id, status) values (${T1}, ${'Viewed Shop ' + tag}, 'pro', 'ready'), (${T2}, ${'Second Shop ' + tag}, 'starter', 'ready'), (${T3}, ${'Closed Shop ' + tag}, 'free', 'offboarded')`;
    await sql`update tenants set closed_at = now() where id = ${T3}`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${T1}, ${owner}, 'owner'), (${T2}, ${stranger}, 'owner'), (${T2}, ${staff}, 'agent')`;       // staff also work in one customer workspace of their own
    contact = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T1}, '+919811100099', 'Viewed Customer', 'allowed') returning id`)[0]!.id;
    conv = (await sql`insert into conversations (tenant_id, contact_id, status, unread) values (${T1}, ${contact}, 'open', 3) returning id`)[0]!.id;
  });
  afterAll(async () => {
    await sql`delete from admin_views where admin_user_id like ${'vw-' + tag + '%'}`;
    await sql`delete from audit_log where tenant_id in (${T1}, ${T2}, ${T3}) or actor_user_id like ${'vw-' + tag + '%'}`;
    await sql`delete from tenants where id in (${T1}, ${T2}, ${T3})`; await sql`delete from "user" where id like ${'vw-' + tag + '%'}`;
    const left = Number((await sql`select count(*)::int n from tenants where id in (${T1}, ${T2}, ${T3})`)[0]!.n);
    await sql.end(); await app.end();
    if (left) throw new Error('view test left workspaces behind');
  });

  describe('starting a view (database rules)', () => {
    it('is refused for anyone who is not staff, and for staff without two-step sign-in', async () => {
      await expect(start(owner, T1)).rejects.toThrow(/platform admin only/);
      await expect(start(stranger, T1)).rejects.toThrow(/platform admin only/);
      await expect(start(noTf, T1)).rejects.toThrow(/platform admin only/);
      await expect(start(customer2fa, T1)).rejects.toThrow(/platform admin only/);       // two-step on is not enough: being staff is the point
      expect(Number((await sql`select count(*)::int n from admin_views where tenant_id = ${T1}`)[0]!.n)).toBe(0);
    });
    it('needs a real reason (5 to 300 characters), a workspace that exists, and one that has not been closed', async () => {
      await expect(start(staff, T1, '')).rejects.toThrow(/at least 5/); await expect(start(staff, T1, '   abc  ')).rejects.toThrow(/at least 5/);
      await expect(start(staff, T1, 'x'.repeat(301))).rejects.toThrow(/too long/);
      await expect(start(staff, randomUUID())).rejects.toThrow(/not found/); await expect(start(staff, T3)).rejects.toThrow(/closed/);
    });
    it('gives a 30-minute view, and writes the reason and the staff member to the customer\'s own log', async () => {
      const v = await start(staff, T1, '  Support ticket 4821: campaign stuck  ');
      expect(v.tenantId).toBe(T1); const mins = (new Date(v.expiresAt).getTime() - Date.now()) / 60000; expect(mins).toBeGreaterThan(29); expect(mins).toBeLessThanOrEqual(30);
      const [l] = await audit(T1, 'admin.view_started'); expect(l!.actor_user_id).toBe(staff); expect(l!.actor_type).toBe('super_admin'); expect(l!.after).toMatchObject({ reason: 'Support ticket 4821: campaign stuck', viewId: v.id, minutes: 30 });
    });
    it('only one live view per staff member: starting another ends the first', async () => {
      const a = await start(staff2, T1), b = await start(staff2, T2);
      expect(await get(staff2, a.id)).toBeNull(); expect((await get(staff2, b.id))!.tenantId).toBe(T2);
    });
    it('the history is for staff only, even when the database function is called directly', async () => {
      await start(staff, T1, 'History is private');
      for (const u of [owner, stranger, customer2fa]) await expect(asApp(u, async (tx) => tx`select public.admin_view_history(${T1}::uuid, 10)`)).rejects.toThrow(/platform admin only/);
      const rows = await asApp(staff, async (tx) => (await tx`select public.admin_view_history(${T1}::uuid, 10) as h`)[0]!.h as { reason: string }[]); expect(rows.some((r) => r.reason === 'History is private')).toBe(true);
    });
    it('the table itself is closed to the app: nobody can read, insert or change views directly', async () => {
      await expect(asApp(staff, async (tx) => tx`select * from admin_views`)).rejects.toThrow(/permission denied/);
      await expect(asApp(staff, async (tx) => tx`insert into admin_views (admin_user_id, tenant_id, reason, expires_at) values (${staff}, ${T1}, 'forged view', now() + interval '10 minutes')`)).rejects.toThrow(/permission denied/);
      await expect(asApp(staff, async (tx) => tx`update admin_views set expires_at = now() + interval '10 minutes'`)).rejects.toThrow(/permission denied/);
    });
    it('the database caps a view at 30 minutes even if something tried to write more', async () => {
      await expect(sql`insert into admin_views (admin_user_id, tenant_id, reason, expires_at) values (${staff}, ${T1}, 'too long a view', now() + interval '2 hours')`).rejects.toThrow(/admin_views_check|check constraint/);
    });
  });

  describe('using a view id', () => {
    it('works only for the staff member it was made for', async () => {
      const v = await start(staff, T1);
      expect((await get(staff, v.id))!.tenantId).toBe(T1);
      expect(await get(staff2, v.id)).toBeNull(); expect(await get(owner, v.id)).toBeNull(); expect(await get(stranger, v.id)).toBeNull();
    });
    it('stops working when ended, expired, or when the staff member loses two-step sign-in or staff status', async () => {
      const ended = await start(staff, T1); await asApp(staff, async (tx) => tx`select public.admin_view_end(${ended.id}::uuid)`); expect(await get(staff, ended.id)).toBeNull();
      const old = await start(staff, T1); await sql`update admin_views set started_at = now() - interval '40 minutes', expires_at = now() - interval '10 minutes' where id = ${old.id}`; expect(await get(staff, old.id)).toBeNull();
      const v = await start(staff, T1); await sql`update "user" set two_factor_enabled = false where id = ${staff}`; expect(await get(staff, v.id)).toBeNull(); await sql`update "user" set two_factor_enabled = true where id = ${staff}`; expect((await get(staff, v.id))!.tenantId).toBe(T1);
      await sql`delete from platform_admins where user_id = ${staff}`; expect(await get(staff, v.id)).toBeNull(); await sql`insert into platform_admins (user_id) values (${staff})`;
    });
    it('stops working if the workspace is closed meanwhile', async () => {
      const v = await start(staff, T2); await sql`update tenants set closed_at = now() where id = ${T2}`; expect(await get(staff, v.id)).toBeNull(); await sql`update tenants set closed_at = null where id = ${T2}`;
    });
    it('ending is only for your own view, logged once with the length, and safe to repeat', async () => {
      const v = await start(staff, T1);
      const other = await asApp(staff2, async (tx) => (await tx`select public.admin_view_end(${v.id}::uuid) as e`)[0]!.e); expect(other).toEqual({ ended: false });
      expect((await get(staff, v.id))!.tenantId).toBe(T1);
      const mine = await asApp(staff, async (tx) => (await tx`select public.admin_view_end(${v.id}::uuid) as e`)[0]!.e); expect(mine).toEqual({ ended: true });
      const again = await asApp(staff, async (tx) => (await tx`select public.admin_view_end(${v.id}::uuid) as e`)[0]!.e); expect(again).toEqual({ ended: false });
      const ends = (await audit(T1, 'admin.view_ended')).filter((l) => (l.after as { viewId: string }).viewId === v.id); expect(ends.length).toBe(1); expect((ends[0]!.after as { seconds: number }).seconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('what the app does with a view', () => {
    const sign = (u: string | null) => { signedIn = u; };
    it('shows the customer workspace read-only as a viewer, with only that workspace in the list', async () => {
      sign(staff); const v = await start(staff, T1, 'Looking at campaign list'); jar.clear(); jar.set('lbc_view', v.id);
      const ctx = await (await S()).requireCtx();
      expect(ctx.workspace.role).toBe('viewer');       // the workspace is shown at the lowest role, so no edit buttons appear
      expect(ctx).toMatchObject({ tenantId: T1, role: 'viewer', readOnly: true, viewing: { id: v.id, tenantName: 'Viewed Shop ' + tag, reason: 'Looking at campaign list' } });
      expect(ctx.workspaces.map((w) => w.tenantId)).toEqual([T1]); expect(ctx.user.id).toBe(staff);       // staff also belong to another workspace (T2), which must NOT appear while viewing
    });
    it('an unknown, malformed, ended or someone else\'s id changes nothing: the person sees only their own workspaces', async () => {
      sign(owner); jar.clear();
      for (const bad of ['not-a-uuid', randomUUID(), '']) { jar.set('lbc_view', bad); const c = await (await S()).requireCtx(); expect(c.tenantId).toBe(T1); expect(c.readOnly).toBeUndefined(); expect(c.role).toBe('owner'); }
      sign(staff2); const v = await start(staff2, T2); sign(stranger); jar.set('lbc_view', v.id);
      const c2 = await (await S()).requireCtx(); expect(c2.tenantId).toBe(T2); expect(c2.role).toBe('owner'); expect(c2.viewing).toBeUndefined();     // stranger really owns T2 and is just themselves
      sign(owner); jar.set('lbc_view', v.id); const c3 = await (await S()).requireCtx(); expect(c3.tenantId).toBe(T1); expect(c3.viewing).toBeUndefined();     // a customer holding staff's id gets nothing extra
    });
    it('a customer cannot start a view by hand: the staff actions are closed to them', async () => {
      sign(owner); jar.clear(); const a = await A();
      await expect(a.startView(T2, 'I would like to look')).rejects.toThrow('NEXT_NOT_FOUND'); expect(jar.has('lbc_view')).toBe(false);
      sign(noTf); await expect(a.startView(T1, 'Staff without two-step')).rejects.toThrow('NEXT_NOT_FOUND'); expect(jar.has('lbc_view')).toBe(false);
    });
    it('the start action sets the cookie, refuses a bad reason, and the end action clears it and ends the view', async () => {
      sign(staff); jar.clear(); const a = await A();
      expect(await a.startView(T1, 'abc')).toMatchObject({ ok: false }); expect(jar.has('lbc_view')).toBe(false);
      expect(await a.startView('not-a-uuid', 'a good reason')).toMatchObject({ ok: false });
      const r = await a.startView(T1, 'Customer cannot see their templates'); expect(r).toEqual({ ok: true, data: { tenantName: 'Viewed Shop ' + tag } });
      const id = jar.get('lbc_view')!; expect(id).toMatch(/^[0-9a-f-]{36}$/); expect((await (await S()).requireCtx()).readOnly).toBe(true);
      expect(await a.endView()).toEqual({ ok: true, data: { ended: true } }); expect(jar.has('lbc_view')).toBe(false); expect(await get(staff, id)).toBeNull();
      const after = await (await S()).requireCtx(); expect(after.tenantId).toBe(T2); expect(after.role).toBe('agent'); expect(after.readOnly).toBeUndefined();       // back to their own workspace, with their own normal role
      expect(await a.endView()).toEqual({ ok: true, data: { ended: false } });
    });
    it('the staff history shows who looked, why and when, and only staff can read it', async () => {
      sign(staff); const a = await A(); await a.startView(T1, 'History check reason'); const h = await a.loadViews(T1);
      expect(h.ok && h.data.some((x) => x.staff === staff + '@example.com' && x.reason === 'History check reason' && x.endedAt === null)).toBe(true);
      sign(owner); await expect(a.loadViews(T1)).rejects.toThrow('NEXT_NOT_FOUND');
    });
  });

  describe('nothing can be changed while viewing', () => {
    const sign = (u: string | null) => { signedIn = u; };
    const viewCtx = async () => { const t = await T(); return { user: { id: staff, name: 'N', email: '' }, tenantId: T1, workspace: { tenantId: T1, name: 'x', role: 'viewer' as const, plan: 'pro' }, role: 'viewer' as const, readOnly: true, db: t.db }; };
    it('reads work', async () => {
      const c = await viewCtx(); const n = await c.db(c, async (tx) => (await tx.execute((await import('drizzle-orm')).sql`select count(*)::int n from contacts`)) as unknown as { n: number }[]);
      expect(n[0]!.n).toBe(1);
    });
    it('the database itself refuses every kind of write, whatever the app code says', async () => {
      const { sql: q } = await import('drizzle-orm'); const c = await viewCtx(); const w = (stmt: ReturnType<typeof q>) => c.db(c, (tx) => tx.execute(stmt));
      await expect(w(q`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T1}::uuid, '+919811100098', 'Sneaky', 'allowed')`)).rejects.toThrow(/read-only/);
      await expect(w(q`update contacts set name = 'Changed' where tenant_id = ${T1}::uuid`)).rejects.toThrow(/read-only/);
      await expect(w(q`delete from contacts where tenant_id = ${T1}::uuid`)).rejects.toThrow(/read-only/);
      await expect(w(q`update tenants set name = 'Hijacked' where id = ${T1}::uuid`)).rejects.toThrow(/read-only/);
      await expect(w(q`select public.write_audit('forged', 'x', '', null)`)).rejects.toThrow(/read-only/);
      const row = (await sql`select name from contacts where id = ${contact}`)[0]!; expect(row.name).toBe('Viewed Customer'); expect((await sql`select name from tenants where id = ${T1}`)[0]!.name).toBe('Viewed Shop ' + tag);
    });
    it('a normal customer session is NOT read-only (the flag is what switches it on)', async () => {
      const { sql: q } = await import('drizzle-orm'); const t = await T(); const ctx = { user: { id: owner, name: 'O', email: '' }, tenantId: T1 };
      await t.db(ctx, (tx) => tx.execute(q`update contacts set name = 'Renamed by owner' where id = ${contact}::uuid`));
      expect((await sql`select name from contacts where id = ${contact}`)[0]!.name).toBe('Renamed by owner'); await sql`update contacts set name = 'Viewed Customer' where id = ${contact}`;
    });
    it('real actions run through a staff view change nothing: a chat stays unread, a contact cannot be added', async () => {
      sign(staff); const a = await A(); jar.clear(); await a.startView(T1, 'Check what the owner sees');
      const chats = await import('../src/app/(app)/chats/actions'); const opened = await chats.openConversation(conv); expect(opened?.conv.id).toBe(conv);
      expect((await sql`select unread from conversations where id = ${conv}`)[0]!.unread).toBe(3);
      const contacts = await import('../src/app/(app)/contacts/actions'); const before = Number((await sql`select count(*)::int n from contacts where tenant_id = ${T1}`)[0]!.n);
      const add = await (contacts as unknown as Record<string, (...x: unknown[]) => Promise<{ ok: boolean }>>).addContact?.({ name: 'Added By Staff', phone: '9811100077', consent: 'allowed' }).catch((e: Error) => ({ ok: false, error: e.message }));
      expect(add === undefined || add.ok === false).toBe(true); expect(Number((await sql`select count(*)::int n from contacts where tenant_id = ${T1}`)[0]!.n)).toBe(before);
      await a.endView();
    });
    it('the customer can see in their own log that it happened, and why, but never the staff member\'s secrets', async () => {
      const rows = await sql`select action, after from audit_log where tenant_id = ${T1} and action in ('admin.view_started', 'admin.view_ended') order by id`;
      expect(rows.length).toBeGreaterThanOrEqual(4); expect(rows.some((r) => r.action === 'admin.view_started' && (r.after as { reason: string }).reason === 'Check what the owner sees')).toBe(true);
      expect(JSON.stringify(rows.map((r) => r.after))).not.toMatch(/password|secret|token/i);
      const asOwner = await asApp(owner, async (tx) => { await tx`select set_config('app.tenant_id', ${T1}, true)`; return tx`select action from audit_log where action like 'admin.view_%'`; });
      expect(asOwner.length).toBeGreaterThanOrEqual(4);
    });
  });
});

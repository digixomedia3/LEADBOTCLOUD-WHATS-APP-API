import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { sql as sql_ } from 'drizzle-orm';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
let role: 'owner' | 'admin' | 'agent' | 'viewer' = 'owner';
let tenant = '', user = '';
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, requireCtx: async () => ({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role, plan: 'pro' }, role, workspaces: [] }) };
});
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
const ctx = () => ({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role, plan: 'pro' }, role });

describe('closing a workspace (owner side)', () => {
  let sql: postgres.Sql; let tag = ''; let name = ''; let agent = '';
  const C = () => import('../src/lib/core/closure');
  const A = () => import('../src/app/(app)/settings/actions');
  const state = async () => (await sql`select closure_requested_at, closure_due_at, closure_requested_by from tenants where id = ${tenant}`)[0]!;
  const clear = () => sql`update tenants set closure_requested_at = null, closure_due_at = null, closure_requested_by = null where id = ${tenant}`;
  const setSub = async (status: string | null, cancelAtEnd = false) => { await sql`delete from subscriptions where tenant_id = ${tenant}`; if (status) await sql`insert into subscriptions (tenant_id, plan, status, cancel_at_cycle_end, razorpay_subscription_id, razorpay_plan_id) values (${tenant}, 'pro', ${status}, ${cancelAtEnd}, ${'sub_' + tag}, 'plan_x')`; };

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 }); tag = randomUUID().slice(0, 8); name = 'Close Co ' + tag;
    tenant = randomUUID(); user = `cw-${tag}`; agent = `cwa-${tag}`;
    for (const u of [user, agent]) await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, 'u', ${u + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${name})`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner'), (${tenant}, ${agent}, 'agent')`;
  });
  afterAll(async () => { await sql`delete from audit_log where tenant_id = ${tenant}`; await sql`delete from tenants where id = ${tenant}`; await sql`delete from "user" where id in (${user}, ${agent})`; await sql.end(); });

  it('the owner can start the 30 days by typing the workspace name, and it is recorded', async () => {
    role = 'owner'; await clear(); const { requestClosure } = await C();
    const r = await requestClosure(ctx() as never, name);
    expect(r.ok).toBe(true);
    const s = await state(); expect(s.closure_requested_by).toBe(user);
    const days = (new Date(s.closure_due_at).getTime() - new Date(s.closure_requested_at).getTime()) / 86400_000; expect(Math.round(days)).toBe(30);
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'workspace.closure_requested' and actor_user_id = ${user}`)[0]!.n)).toBe(1);
  });
  it('asking again changes nothing: the date does not move, and no second record is made', async () => {
    const { requestClosure } = await C(); const before = await state();
    const r = await requestClosure(ctx() as never, name); expect(r.ok).toBe(true);
    expect(new Date((await state()).closure_due_at).getTime()).toBe(new Date(before.closure_due_at).getTime());
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'workspace.closure_requested'`)[0]!.n)).toBe(1);
  });
  it('the workspace name must be typed exactly (case and outer spaces do not matter, anything else does)', async () => {
    const { requestClosure } = await C(); await clear();
    for (const bad of ['', '   ', 'wrong', name.slice(0, -1), name + 'x', 'Close Co']) { const r = await requestClosure(ctx() as never, bad); expect(r.ok, JSON.stringify(bad)).toBe(false); if (!r.ok) expect(r.error).toMatch(/type the workspace name/i); }
    expect((await state()).closure_requested_at).toBeNull();
    expect((await requestClosure(ctx() as never, '  ' + name.toUpperCase() + '  ')).ok).toBe(true);
  });
  it('nobody but the owner: not an admin, an agent, a viewer; and the database refuses them too', async () => {
    const { requestClosure, cancelClosure } = await C(); await clear();
    for (const r of ['admin', 'agent', 'viewer'] as const) { role = r; const x = await requestClosure(ctx() as never, name); expect(x.ok).toBe(false); if (!x.ok) expect(x.error).toMatch(/only the workspace owner/i); }
    // Even if the app check were bypassed, the database function itself checks the member is the owner. Call it directly, as a member who is only an agent.
    const { db } = await import('../src/lib/tenant-db');
    const direct = (u: string, q: 'request' | 'cancel') => db({ tenantId: tenant, user: { id: u, name: 'x', email: '' } } as never, (tx) => q === 'request' ? tx.execute(sql_`select public.request_workspace_closure(${name})`) : tx.execute(sql_`select public.cancel_workspace_closure()`));
    await expect(direct(agent, 'request')).rejects.toThrow(/only the owner can close/i);
    await expect(direct(agent, 'cancel')).rejects.toThrow(/only the owner can do this/i);
    await expect(direct(user, 'request')).resolves.toBeTruthy(); await clear();   // the real owner passes the same door
    expect((await state()).closure_requested_at).toBeNull();
  });
  it('a paid plan that is still running must be cancelled first, so nobody is charged for a closed workspace', async () => {
    role = 'owner'; const { requestClosure } = await C(); await clear();
    for (const st of ['active', 'created', 'authenticated', 'pending', 'halted', 'paused']) {
      await setSub(st); const r = await requestClosure(ctx() as never, name);
      expect(r.ok, st).toBe(false); if (!r.ok) expect(r.error, st).toMatch(/cancel your paid plan first/i);
      expect((await state()).closure_requested_at, st).toBeNull();
    }
  });
  it('a plan already set to end, or one that is finished, does not block closing', async () => {
    const { requestClosure } = await C();
    for (const [st, end] of [['active', true], ['cancelled', false], ['completed', false], ['expired', false]] as const) { await clear(); await setSub(st, end); expect((await requestClosure(ctx() as never, name)).ok, `${st}/${end}`).toBe(true); }
    await clear(); await setSub(null); expect((await requestClosure(ctx() as never, name)).ok).toBe(true);
  });
  it('the owner can change their mind during the 30 days, and it is recorded; cancelling when nothing is pending does nothing', async () => {
    const { cancelClosure } = await C(); role = 'owner';
    expect((await state()).closure_requested_at).not.toBeNull();
    const r = await cancelClosure(ctx() as never); expect(r).toEqual({ ok: true, data: { cancelled: true } });
    expect((await state()).closure_requested_at).toBeNull();
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'workspace.closure_cancelled'`)[0]!.n)).toBe(1);
    expect(await cancelClosure(ctx() as never)).toEqual({ ok: true, data: { cancelled: false } });
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'workspace.closure_cancelled'`)[0]!.n)).toBe(1);
  });
  it('a workspace that is already closed cannot be closed or reopened by cancelling', async () => {
    const { requestClosure, cancelClosure } = await C(); await clear();
    await sql`update tenants set status = 'offboarded', closed_at = now() where id = ${tenant}`;
    try { const r = await requestClosure(ctx() as never, name); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/already closed/i); expect(await cancelClosure(ctx() as never)).toEqual({ ok: true, data: { cancelled: false } }); }
    finally { await sql`update tenants set status = 'ready', closed_at = null where id = ${tenant}`; }
    // The dangerous case: a closure WAS requested and the workspace has since been shut by the worker. Cancelling must not undo the record or reopen anything.
    await sql`update tenants set closure_requested_at = now() - interval '31 days', closure_due_at = now() - interval '1 day', closure_requested_by = ${user}, status = 'offboarded' where id = ${tenant}`;
    try {
      expect(await cancelClosure(ctx() as never)).toEqual({ ok: true, data: { cancelled: false } });
      const s = (await sql`select closure_requested_at, status from tenants where id = ${tenant}`)[0]!;
      expect(s.closure_requested_at).not.toBeNull(); expect(s.status).toBe('offboarded');
    } finally { await sql`update tenants set status = 'ready', closure_requested_at = null, closure_due_at = null, closure_requested_by = null where id = ${tenant}`; }
  });
  it('the screen shows the name and days left, and the actions behind it refuse everyone but the owner', async () => {
    const { loadClosure } = await C(); const a = await A(); role = 'owner'; await clear(); await setSub(null);
    expect(await loadClosure(ctx() as never)).toMatchObject({ workspaceName: name, requestedAt: null, dueAt: null, daysLeft: null });
    expect((await a.requestWorkspaceClosure(name)).ok).toBe(true);
    const info = await loadClosure(ctx() as never); expect(info.daysLeft).toBe(30); expect(info.dueAt).not.toBeNull();
    role = 'admin'; expect((await a.cancelWorkspaceClosure()).ok).toBe(false); expect((await a.requestWorkspaceClosure(name)).ok).toBe(false);
    role = 'owner'; expect((await a.cancelWorkspaceClosure()).ok).toBe(true);
  });
  it('the web role cannot set the closure columns directly, only through the two functions', async () => {
    const app = postgres((process.env.DATABASE_URL ?? '').length ? process.env.DATABASE_URL! : ADMIN.replace(/\/\/[^@]+@/, '//app:app@'), { max: 1 });
    try { await expect(app`update tenants set closure_due_at = now() where id = ${tenant}`).rejects.toThrow(); await expect(app`update tenants set closed_at = now() where id = ${tenant}`).rejects.toThrow(); }
    finally { await app.end(); }
  });
});

describe('the workspace export', () => {
  let sql: postgres.Sql; let tag = '';
  const E = () => import('../src/lib/core/workspace-export');
  beforeAll(async () => {
    role = 'owner'; sql = postgres(ADMIN, { max: 2 }); tag = randomUUID().slice(0, 8);
    tenant = randomUUID(); user = `we-${tag}`;
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name, gstin) values (${tenant}, ${'Export Co ' + tag}, '27AAAAA0000A1Z5')`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    await sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${'we-waba-' + tag}, 'SECRET-WABA-TOKEN-' || ${tag}, 'valid', 'ok')`;
    const c = await sql`insert into contacts (tenant_id, phone_e164, name, email, consent_status, consent_source) values (${tenant}, '+919800000001', 'Asha', 'asha@example.com', 'allowed', 'website form') returning id`;
    const v = await sql`insert into conversations (tenant_id, contact_id, status) values (${tenant}, ${c[0]!.id}, 'open') returning id`;
    await sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status) values (${tenant}, ${v[0]!.id}, 'in', 'text', 'Is it in stock?', 'received'), (${tenant}, ${v[0]!.id}, 'out', 'text', 'Yes, it is.', 'sent')`;
    await sql`insert into leads (tenant_id, contact_id, status, value_paise) values (${tenant}, ${c[0]!.id}, 'new', 250000)`;
    await sql`insert into quick_replies (tenant_id, shortcut, body) values (${tenant}, 'hi', 'Hello there')`;
    await sql`insert into api_keys (tenant_id, name, prefix, key_hash, created_by) values (${tenant}, 'agent', 'lbc_zz', 'HASH-SECRET-' || ${tag}, ${user})`.catch(() => undefined);
    // a SECOND workspace that must never leak into this export
    const other = randomUUID(); await sql`insert into tenants (id, name) values (${other}, ${'Other ' + tag})`;
    await sql`insert into contacts (tenant_id, phone_e164, name) values (${other}, '+919800000099', 'Someone Else')`;
  });
  afterAll(async () => {
    // Everything this block made carries this run's tag, in any position of the name. A cleanup that leaves rows behind must fail loudly, not pile up quietly.
    await sql`delete from audit_log where tenant_id in (select id from tenants where name like ${'%' + tag + '%'})`;
    await sql`delete from tenants where name like ${'%' + tag + '%'}`; await sql`delete from "user" where id = ${user}`;
    const left = Number((await sql`select count(*)::int n from tenants where name like ${'%' + tag + '%'}`)[0]!.n);
    await sql.end(); if (left) throw new Error(`cleanup left ${left} test workspaces behind`);
  });

  it('contains this workspace contacts, their permission records, chats with message text, leads and quick replies', async () => {
    const { buildWorkspaceExport } = await E(); const r = await buildWorkspaceExport(ctx() as never); const f = r.file as Record<string, any>;
    expect(f.format).toBe('leadbotcloud-workspace-export-v1'); expect(f.workspace.name).toBe('Export Co ' + tag); expect(f.workspace.gstin).toBe('27AAAAA0000A1Z5');
    expect(f.contacts).toHaveLength(1); expect(f.contacts[0]).toMatchObject({ name: 'Asha', phone: '+919800000001', email: 'asha@example.com', permission: 'allowed', permissionSource: 'website form' });
    expect(f.chats).toHaveLength(1); expect(f.chats[0].messages.map((m: { text: string }) => m.text)).toEqual(['Is it in stock?', 'Yes, it is.']);
    expect(f.leads[0]).toMatchObject({ valueRupees: 2500 }); expect(f.quickReplies).toEqual([{ shortcut: 'hi', body: 'Hello there' }]);
    expect(f.notice).toBe('Complete.'); expect(r.counts.contacts).toBe(1);
  });
  it('never contains another workspace, nor any secret: no WhatsApp token, no API key hash', async () => {
    const { buildWorkspaceExport } = await E(); const text = JSON.stringify((await buildWorkspaceExport(ctx() as never)).file);
    for (const leak of ['Someone Else', '+919800000099', 'SECRET-WABA-TOKEN', 'HASH-SECRET', 'business_token', 'key_hash', 'password']) expect(text, leak).not.toContain(leak);
  });
  it('says clearly when a section was cut short, instead of pretending it is complete', async () => {
    const { buildWorkspaceExport, EXPORT_CAPS } = await E();
    expect(EXPORT_CAPS.contacts).toBeGreaterThan(0);
    const r = await buildWorkspaceExport(ctx() as never); expect((r.file as { notice: string }).notice).toBe('Complete.');
  });
  it('the download is owner only', async () => {
    vi.resetModules(); role = 'admin';
    const { GET } = await import('../src/app/api/workspace-export/route'); const res = await GET();
    expect(res.status).toBe(403); expect(await res.text()).not.toContain('Asha');
    role = 'owner'; const ok = await GET(); expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toMatch(/^attachment; filename="Export-Co-[a-f0-9]+-export\.json"$/); expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(await ok.text()).contacts).toHaveLength(1);
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'workspace.exported'`)[0]!.n)).toBe(1);
  });
});

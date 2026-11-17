import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

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


const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const HTML = new TextEncoder().encode('<script>alert(1)</script>');

describe('sending a file from the chat', () => {
  let sql: postgres.Sql; let tag = ''; let open = '', closed = '', stopped = '', foreign = '', otherUser = '';
  const F = () => import('../src/lib/core/chat-files');
  const mkConv = async (t: string, consent: string, windowOpen: boolean, n: number) => {
    const c = await sql`insert into contacts (tenant_id, phone_e164, consent_status) values (${t}, ${'+91977' + tag.slice(0, 4).replace(/[a-f]/g, '1') + String(10000 + n)}, ${consent}) returning id`;
    const v = await sql`insert into conversations (tenant_id, contact_id, status, window_expires_at, phone_number_id) values (${t}, ${c[0]!.id}, 'open', ${windowOpen ? new Date(Date.now() + 3600_000) : new Date(Date.now() - 3600_000)}, ${'fc-pn-' + tag}) returning id`;
    return String(v[0]!.id);
  };
  beforeAll(async () => {
    role = 'agent'; sql = postgres(ADMIN, { max: 2 }); tag = randomUUID().slice(0, 8);
    tenant = randomUUID(); user = `fc-${tag}`; otherUser = `fo-${tag}`; const other = randomUUID();
    for (const u of [user, otherUser]) await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, 'u', ${u + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${'FC ' + tag}), (${other}, ${'FC other ' + tag})`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'agent'), (${other}, ${otherUser}, 'owner')`;
    const a = await sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${'fc-waba-' + tag}, 'x', 'valid', 'ok') returning id`;
    await sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${tenant}, ${a[0]!.id}, ${'fc-pn-' + tag}, '+91 9')`;
    open = await mkConv(tenant, 'allowed', true, 1); closed = await mkConv(tenant, 'allowed', false, 2); stopped = await mkConv(tenant, 'stopped', true, 3); foreign = await mkConv(other, 'allowed', true, 4);
  });
  afterAll(async () => { await sql`delete from tenants where name like ${'FC %' + tag}`; await sql`delete from "user" where id in (${user}, ${otherUser})`; await sql.end(); });
  const msgs = async () => await sql`select m.*, a.size_bytes as asize, a.kind as akind, a.created_by from messages m left join message_attachments a on a.message_id = m.id where m.tenant_id = ${tenant} and m.kind in ('image','video','document') order by m.created_at`;

  it('queues a picture with its caption, stored together with its message', async () => {
    const { sendChatFile } = await F();
    const r = await sendChatFile(ctx() as never, open, PNG, 'saree.png', '  This one  ');
    expect(r.ok).toBe(true);
    const m = (await msgs()).find((x) => x.id === (r as { data: { id: string } }).data.id)!;
    expect(m).toMatchObject({ direction: 'out', kind: 'image', status: 'queued', body: 'Photo: This one', akind: 'image', created_by: user });
    expect(m.payload).toEqual({ caption: 'This one' });
    expect(Number(m.asize)).toBe(PNG.length);
    const c = (await sql`select last_preview, assigned_to from conversations where id = ${open}`)[0]!; expect(c.last_preview).toBe('Photo: This one'); expect(c.assigned_to).toBe(user);
  });
  it('a PDF is a document with its file name in the preview', async () => {
    const { sendChatFile } = await F(); const r = await sendChatFile(ctx() as never, open, PDF, 'Quote March.pdf', '');
    expect(r.ok).toBe(true); expect((await msgs()).find((x) => x.id === (r as { data: { id: string } }).data.id)!.body).toBe('Document: Quote March.pdf');
  });
  it('refuses when the 24-hour window is closed, and stores nothing', async () => {
    const { sendChatFile } = await F(); const before = (await msgs()).length;
    const r = await sendChatFile(ctx() as never, closed, PNG, 'a.png', ''); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/24-hour/);
    expect((await msgs()).length).toBe(before);
  });
  it('refuses a customer who opted out', async () => {
    const { sendChatFile } = await F(); const r = await sendChatFile(ctx() as never, stopped, PNG, 'a.png', ''); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/opted out/);
  });
  it('refuses a file that is not really a picture, video or PDF, even with a picture name', async () => {
    const { sendChatFile } = await F(); const before = (await msgs()).length;
    const r = await sendChatFile(ctx() as never, open, HTML, 'photo.jpg', ''); expect(r.ok).toBe(false); expect((await msgs()).length).toBe(before);
  });
  it('another workspace conversation is simply not found, and a bad id never reaches the database', async () => {
    const { sendChatFile } = await F();
    const r = await sendChatFile(ctx() as never, foreign, PNG, 'a.png', ''); expect(r).toEqual({ ok: false, error: 'Conversation not found.' });
    expect(Number((await sql`select count(*)::int as n from messages where conversation_id = ${foreign}`)[0]!.n)).toBe(0);
    expect((await sendChatFile(ctx() as never, "x'; drop table messages;--", PNG, 'a.png', ''))).toEqual({ ok: false, error: 'Conversation not found.' });
  });
  it('with no live number the message is recorded as sent (test mode) and never queued for Meta', async () => {
    const { sendChatFile } = await F();
    await sql`update meta_accounts set token_status = 'invalid' where tenant_id = ${tenant}`;
    try { const r = await sendChatFile(ctx() as never, open, PNG, 'a.png', ''); expect(r.ok).toBe(true); expect((await msgs()).find((x) => x.id === (r as { data: { id: string } }).data.id)!.status).toBe('sent'); }
    finally { await sql`update meta_accounts set token_status = 'valid' where tenant_id = ${tenant}`; }
  });
  it('sending a file never takes a chat that someone else is already handling', async () => {
    const { sendChatFile } = await F();
    await sql`update conversations set assigned_to = ${otherUser} where id = ${open}`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${otherUser}, 'agent') on conflict do nothing`;
    try { expect((await sendChatFile(ctx() as never, open, PNG, 'a.png', '')).ok).toBe(true); expect((await sql`select assigned_to from conversations where id = ${open}`)[0]!.assigned_to).toBe(otherUser); }
    finally { await sql`update conversations set assigned_to = null where id = ${open}`; }
  });
  it('one person is held to 60 files an hour, and can send again once old ones are gone', async () => {
    const { sendChatFile, FILES_PER_HOUR } = await F();
    const now = Number((await sql`select count(*)::int as n from message_attachments where created_by = ${user} and created_at > now() - interval '1 hour'`)[0]!.n);
    expect(FILES_PER_HOUR).toBe(60);
    const fill = FILES_PER_HOUR - now;
    for (let i = 0; i < fill; i++) { const x = (await sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status) values (${tenant}, ${open}, 'out', 'image', 'x', 'sent') returning id`)[0]!.id;
      await sql`insert into message_attachments (tenant_id, message_id, kind, mime, file_name, size_bytes, sha256, data, created_by) values (${tenant}, ${x}, 'image', 'image/png', 'x.png', 1, 'x', ${Buffer.from([1])}, ${user})`; }
    const r = await sendChatFile(ctx() as never, open, PNG, 'a.png', ''); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/60 files/);
    await sql`delete from message_attachments where tenant_id = ${tenant} and sha256 = 'x'`;
    expect((await sendChatFile(ctx() as never, open, PNG, 'a.png', '')).ok).toBe(true);
  });
});

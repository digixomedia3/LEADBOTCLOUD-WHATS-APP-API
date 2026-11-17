import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { runRetention } from '../src/retention';

const w = createDb(process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud', { max: 3 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const db = w.db; const rows = (r: unknown) => r as Record<string, any>[];
afterAll(async () => { await admin.client.unsafe(`delete from tenants where name like 'RT %'`); await Promise.all([w.client.end(), admin.client.end()]); });

const made: string[] = [];
const run = (o: { days?: number; batch?: number }) => runRetention(db, { ...o, tenantIds: made });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
async function tenant() {
  const t = randomUUID(); made.push(t); await admin.client.unsafe(`insert into tenants (id, name) values ('${t}', 'RT ${t.slice(0, 8)}')`);
  const c = rows(await db.execute(sql`insert into contacts (tenant_id, phone_e164, consent_status) values (${t}, ${'+9197' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'allowed') returning id`))[0]!;
  const v = rows(await db.execute(sql`insert into conversations (tenant_id, contact_id, status) values (${t}, ${c.id}, 'open') returning id`))[0]!;
  return { t, conv: String(v.id) };
}
const ago = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
async function inboundFile(f: { t: string; conv: string }, ageDays: number, state = 'stored') {
  const m = rows(await db.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status, created_at) values (${f.t}, ${f.conv}, 'in', 'image', 'Photo: keep this text', 'received', ${ago(ageDays)}::timestamptz) returning id`))[0]!;
  await db.execute(sql`insert into inbound_media (tenant_id, message_id, kind, meta_media_id, mime, state, data, size_bytes, created_at) values (${f.t}, ${m.id}, 'image', ${'M' + randomUUID().slice(0, 6)}, 'image/png', ${state}, ${state === 'stored' ? PNG : null}, ${state === 'stored' ? PNG.length : null}, ${ago(ageDays)}::timestamptz)`);
  return String(m.id);
}
async function sentFile(f: { t: string; conv: string }, ageDays: number) {
  const m = rows(await db.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status) values (${f.t}, ${f.conv}, 'out', 'image', 'Photo: sent text', 'sent') returning id`))[0]!;
  await db.execute(sql`insert into message_attachments (tenant_id, message_id, kind, mime, file_name, size_bytes, sha256, data, created_at) values (${f.t}, ${m.id}, 'image', 'image/png', 'a.png', ${PNG.length}, 'x', ${PNG}, ${ago(ageDays)}::timestamptz)`);
  return String(m.id);
}
const media = async (mid: string) => rows(await db.execute(sql`select state, data, size_bytes from inbound_media where message_id = ${mid}`))[0];
const sent = async (mid: string) => rows(await db.execute(sql`select id from message_attachments where message_id = ${mid}`)).length;
const body = async (mid: string) => rows(await db.execute(sql`select body from messages where id = ${mid}`))[0]?.body;
const big = { batch: 100000 };

describe('file retention', () => {
  it('a customer file older than the limit loses its bytes, becomes expired, and its message text stays', async () => {
    const f = await tenant(); const old = await inboundFile(f, 100), fresh = await inboundFile(f, 5);
    const r = await run({ days: 90, ...big }); expect(r.inbound).toBeGreaterThanOrEqual(1);
    const o = (await media(old))!; expect(o.state).toBe('expired'); expect(o.data).toBeNull();
    const n = (await media(fresh))!; expect(n.state).toBe('stored'); expect(Buffer.from(n.data).equals(PNG)).toBe(true);
    expect(await body(old)).toBe('Photo: keep this text');
  });
  it('a file exactly at the edge is judged by age: 89 days stays, 91 goes', async () => {
    const f = await tenant(); const a = await inboundFile(f, 89), b = await inboundFile(f, 91);
    await run({ days: 90, ...big });
    expect((await media(a))!.state).toBe('stored'); expect((await media(b))!.state).toBe('expired');
  });
  it('a file we sent is removed after the limit, and a recent one is kept, text untouched', async () => {
    const f = await tenant(); const old = await sentFile(f, 100), fresh = await sentFile(f, 2);
    await run({ days: 90, ...big });
    expect(await sent(old)).toBe(0); expect(await sent(fresh)).toBe(1); expect(await body(old)).toBe('Photo: sent text');
  });
  it('files that never downloaded are expired too, so nothing lingers as pending forever', async () => {
    const f = await tenant(); const p = await inboundFile(f, 120, 'pending'), x = await inboundFile(f, 120, 'failed'), l = await inboundFile(f, 120, 'too_large');
    await run({ days: 90, ...big });
    for (const m of [p, x, l]) expect((await media(m))!.state).toBe('expired');
  });
  it('an expired file is not touched again, and running twice changes nothing more', async () => {
    const f = await tenant(); const old = await inboundFile(f, 100);
    await run({ days: 90, ...big }); const second = await run({ days: 90, ...big });
    expect((await media(old))!.state).toBe('expired'); expect(second.inbound).toBe(0);
  });
  it('the limit can never be set below a week, so a typo cannot wipe recent files', async () => {
    const f = await tenant(); const d3 = await inboundFile(f, 3), d10 = await inboundFile(f, 10);
    await run({ days: 0, ...big }); expect((await media(d3))!.state).toBe('stored'); expect((await media(d10))!.state).toBe('expired');
    const d5 = await inboundFile(f, 5); await run({ days: -50, ...big }); expect((await media(d5))!.state).toBe('stored');
    await run({ days: Number.NaN, ...big }); expect((await media(d5))!.state).toBe('stored');   // not a number: the default, not a crash
    await run({ days: Number('ninety'), batch: Number.NaN }); expect((await media(d5))!.state).toBe('stored');
  });
  it('each pass removes at most the batch size, and later passes finish the rest', async () => {
    const f = await tenant(); const ids: string[] = []; for (let i = 0; i < 5; i++) ids.push(await inboundFile(f, 200));
    await admin.client.unsafe(`update inbound_media set created_at = now() - interval '200 days' where tenant_id = '${f.t}'`);
    const mine = async () => (await Promise.all(ids.map(media))).filter((m) => m!.state === 'expired').length;
    await run({ days: 90, batch: 1 }); const afterOne = await mine(); expect(afterOne).toBeLessThanOrEqual(1);
    for (let i = 0; i < 40 && (await mine()) < 5; i++) await run({ days: 90, batch: 1 });
    expect(await mine()).toBe(5);
  });
  it('a template header file with no template is removed after a day; an attached or fresh one stays', async () => {
    const f = await tenant();
    const mk = async (age: number, attached: boolean) => {
      let tpl: string | null = null;
      if (attached) tpl = String(rows(await db.execute(sql`insert into templates (tenant_id, name, language, category, status, body, category_current) values (${f.t}, ${'rt_' + randomUUID().slice(0, 6)}, 'en', 'utility', 'approved', 'Hi', 'UTILITY') returning id`))[0]!.id);
      return String(rows(await db.execute(sql`insert into template_assets (tenant_id, template_id, kind, mime, file_name, size_bytes, sha256, data, created_at) values (${f.t}, ${tpl}, 'image', 'image/png', 'h.png', ${PNG.length}, 'x', ${PNG}, ${ago(age)}::timestamptz) returning id`))[0]!.id);
    };
    const orphanOld = await mk(3, false), orphanNew = await mk(0, false), attachedOld = await mk(200, true);
    const r = await run({ days: 90, ...big }); expect(r.orphanHeaders).toBeGreaterThanOrEqual(1);
    const has = async (id: string) => rows(await db.execute(sql`select id from template_assets where id = ${id}`)).length;
    expect(await has(orphanOld)).toBe(0); expect(await has(orphanNew)).toBe(1); expect(await has(attachedOld)).toBe(1);
  });
  it('one workspace file age never affects another: each row is judged on its own', async () => {
    const a = await tenant(), b = await tenant(); const oa = await inboundFile(a, 100), nb = await inboundFile(b, 1);
    await run({ days: 90, ...big }); expect((await media(oa))!.state).toBe('expired'); expect((await media(nb))!.state).toBe('stored');
  });
});

describe('retention scope (a pass limited to some workspaces never touches anyone else)', () => {
  it('files of a workspace that is not in the list are left alone, however old', async () => {
    const mine = await tenant(), stranger = await tenant();
    const a = await inboundFile(mine, 300), b = await inboundFile(stranger, 300);
    const only = await runRetention(db, { days: 90, batch: 100000, tenantIds: [mine.t] });
    expect(only.inbound).toBe(1); expect((await media(a))!.state).toBe('expired'); expect((await media(b))!.state).toBe('stored');
  });
  it('an empty list, or ids that are not ids, matches nothing rather than everything', async () => {
    const f = await tenant(); const a = await inboundFile(f, 300);
    for (const ids of [[], ['not-a-uuid'], ["x'; delete from messages;--"]]) { const r = await runRetention(db, { days: 90, batch: 100000, tenantIds: ids }); expect(r).toEqual({ inbound: 0, sent: 0, orphanHeaders: 0 }); }
    expect((await media(a))!.state).toBe('stored');
  });
});

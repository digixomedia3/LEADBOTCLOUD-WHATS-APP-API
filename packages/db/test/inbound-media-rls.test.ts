import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, withTenant } from '../src';

// Customer files are the one table the web side may only READ, and only for its own workspace. Run as the real `app` role.
const app = createDb(process.env.DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const worker = createDb(process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const owner = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud', { max: 1 });
const A = randomUUID(), B = randomUUID();
let fileA = '', fileB = '', msgA = '';
const rows = (r: unknown) => r as Record<string, any>[];

beforeAll(async () => {
  await owner.client.unsafe(`insert into tenants (id, name) values ('${A}', 'IMRLS A'), ('${B}', 'IMRLS B')`);
  for (const [t, set] of [[A, 'a'], [B, 'b']] as const) {
    const c = rows(await worker.db.execute(sql`insert into contacts (tenant_id, phone_e164, consent_status) values (${t}, ${'+9190000' + (set === 'a' ? '11111' : '22222')}, 'unknown') returning id`))[0]!;
    const v = rows(await worker.db.execute(sql`insert into conversations (tenant_id, contact_id, status) values (${t}, ${c.id}, 'open') returning id`))[0]!;
    const m = rows(await worker.db.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status) values (${t}, ${v.id}, 'in', 'image', 'Photo', 'received') returning id`))[0]!;
    const f = rows(await worker.db.execute(sql`insert into inbound_media (tenant_id, message_id, kind, meta_media_id, mime, state, data, size_bytes) values (${t}, ${m.id}, 'image', ${'M' + set}, 'image/png', 'stored', ${Buffer.from('x')}, 1) returning id`))[0]!;
    if (set === 'a') { fileA = String(f.id); msgA = String(m.id); } else fileB = String(f.id);
  }
});
afterAll(async () => {
  await owner.client.unsafe(`delete from tenants where id in ('${A}','${B}')`);
  await Promise.all([app.client.end(), worker.client.end(), owner.client.end()]);
});

describe('inbound_media row security (as the web role)', () => {
  it('a workspace sees its own file and never another workspace file', async () => {
    const seen = await withTenant(app.db, { tenantId: A }, async (tx) => rows(await tx.execute(sql`select id from inbound_media`)).map((r) => String(r.id)));
    expect(seen).toEqual([fileA]);
    const other = await withTenant(app.db, { tenantId: A }, async (tx) => rows(await tx.execute(sql`select id from inbound_media where id = ${fileB}`)));
    expect(other.length).toBe(0);   // asking for B's id by hand gets nothing: the route turns that into 404
  });
  it('the web role cannot write, change or delete customer files', async () => {
    await expect(withTenant(app.db, { tenantId: A }, (tx) => tx.execute(sql`insert into inbound_media (tenant_id, message_id, kind, meta_media_id) values (${A}, ${msgA}, 'image', 'x')`))).rejects.toThrow();
    await expect(withTenant(app.db, { tenantId: A }, (tx) => tx.execute(sql`update inbound_media set state = 'failed'`))).rejects.toThrow();
    await expect(withTenant(app.db, { tenantId: A }, (tx) => tx.execute(sql`delete from inbound_media`))).rejects.toThrow();
  });
  it('without a workspace set, the web role sees nothing', async () => {
    const n = rows(await app.db.execute(sql`select count(*)::int as n from inbound_media`))[0]!.n;
    expect(Number(n)).toBe(0);
  });
  it('deleting a message removes its file, and the database refuses a stored row with no bytes', async () => {
    await expect(owner.client.unsafe(`update inbound_media set data = null where id = '${fileB}'`)).rejects.toThrow();
    await owner.client.unsafe(`delete from messages where id = '${msgA}'`);
    expect(Number(rows(await worker.db.execute(sql`select count(*)::int as n from inbound_media where id = ${fileA}`))[0]!.n)).toBe(0);
  });
});

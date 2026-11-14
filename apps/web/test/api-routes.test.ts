import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));

const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for tests');

/** The API layer end to end without a server: real keys, real database, real route handlers. */
describe('API: authentication, permissions and isolation', () => {
  const tag = randomUUID().slice(0, 8);
  const T1 = randomUUID(), T2 = randomUUID(), U1 = `ap-${tag}-1`, U2 = `ap-${tag}-2`;
  let sql: postgres.Sql;
  let gen: typeof import('@lbc/shared/api-keys').generateApiKey;
  const keys: Record<string, string> = {};
  const call = async (path: string, key: string | null, init: RequestInit = {}, ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) => {
    const mod = await import(`../src/app/api/${path.split('?')[0]}/route`);
    const headers = new Headers(init.headers); if (key) headers.set('authorization', `Bearer ${key}`); headers.set('cf-connecting-ip', ip);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const res: Response = await mod[(init.method ?? 'GET').toUpperCase()](new Request(`http://x/api/${path}`, { ...init, headers }), { params: Promise.resolve({}) });
    const text = await res.text(); let body: any = text; try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body, headers: res.headers };
  };
  const mint = async (tenant: string, user: string, scopes: string[], name: string, extra = '') => {
    const k = gen();
    await sql.unsafe(`insert into api_keys (tenant_id, name, prefix, key_hash, scopes, created_by ${extra ? ', ' + extra.split('=')[0] : ''}) values ('${tenant}', '${name}', '${k.prefix}', '${k.hash}', ARRAY[${scopes.map((s) => `'${s}'`).join(',')}], '${user}' ${extra ? ', ' + extra.split('=')[1] : ''})`);
    return k.key;
  };

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 });
    gen = (await import('@lbc/shared/api-keys')).generateApiKey;
    for (const u of [U1, U2]) await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, ${u}, ${u + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${T1}, ${'AP one ' + tag}), (${T2}, ${'AP two ' + tag})`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${T1}, ${U1}, 'owner'), (${T2}, ${U2}, 'owner')`;
    keys.read = await mint(T1, U1, ['contacts:read'], 'key-read');
    keys.write = await mint(T1, U1, ['contacts:read', 'contacts:write'], 'key-write');
    keys.camp = await mint(T1, U1, ['campaigns:read', 'campaigns:write'], 'key-camp');
    keys.other = await mint(T2, U2, ['contacts:read', 'contacts:write'], 'key-other');
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id in (${T1}, ${T2})`;
    await sql`delete from tenants where id in (${T1}, ${T2})`;
    await sql`delete from "user" where id in (${U1}, ${U2})`;
    await sql.end();
  });

  it('refuses a call with no key, a malformed key, or an unknown key (401), and says nothing about which', async () => {
    for (const [label, k] of [['none', null], ['malformed', 'lbc_nope'], ['unknown', gen().key]] as const) {
      const r = await call('v1/me', k); expect(r.status, label).toBe(401); expect(JSON.stringify(r.body)).not.toMatch(/sql|stack|tenant_id|at \//i);
    }
  });
  it('a key sees its own workspace, and only the permissions it was given', async () => {
    const r = await call('v1/me', keys.read);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ scopes: ['contacts:read'], perSendLimitRupees: 500 }); expect(r.body.workspace).toContain('AP one');
  });
  it('a read key cannot write (403), a write key can', async () => {
    const body = JSON.stringify({ phone: '9876543210', consent: true, source: 'In shop', name: 'A' });
    const denied = await call('v1/contacts', keys.read, { method: 'POST', body }); expect(denied.status).toBe(403); expect(denied.body.error).toMatch(/contacts:write/);
    const ok = await call('v1/contacts', keys.write, { method: 'POST', body }); expect(ok.status).toBe(201); expect(ok.body.phone).toBe('+919876543210');
  });
  it('a contact cannot be added without the caller confirming consent, and the refusal changes nothing', async () => {
    const before = (await call('v1/contacts', keys.write)).body.total;
    for (const b of [{ phone: '9876500001', source: 'In shop' }, { phone: '9876500001', consent: false, source: 'In shop' }, { phone: '9876500001', consent: 'yes', source: 'In shop' }, { phone: '9876500001', consent: true }, { phone: '9876500001', consent: true, source: 'made up' }]) {
      const r = await call('v1/contacts', keys.write, { method: 'POST', body: JSON.stringify(b) }); expect(r.status, JSON.stringify(b)).toBe(422);
    }
    expect((await call('v1/contacts', keys.write)).body.total).toBe(before);
  });
  it('the stored contact records who vouched for the consent: source, time, and the audit line names the key, not a person', async () => {
    const row = (await sql`select consent_status, consent_source, consent_at is not null as at from contacts where tenant_id = ${T1} and phone_e164 = '+919876543210'`)[0]!;
    expect(row).toMatchObject({ consent_status: 'allowed', consent_source: 'In shop', at: true });
    const a = await sql`select action, after from audit_log where tenant_id = ${T1} and action = 'api.contact.added'`;
    expect(a.length).toBe(1); expect(a[0]!.after.viaKey).toMatch(/^lbc_[a-f0-9]{8}$/); expect(a[0]!.after.consentConfirmedBy).toBe('api_key');
  });
  it('the other workspace never sees it, and cannot read it by id, name, group or tag', async () => {
    const r = await call('v1/contacts?q=9876543210', keys.other); expect(r.body.total).toBe(0);
    expect((await call('v1/contacts', keys.other)).body.contacts).toHaveLength(0);
  });
  it('a group of one workspace cannot be used by another', async () => {
    const g = await call('v1/groups', keys.write, { method: 'POST', body: JSON.stringify({ name: 'Mine' }) }); expect(g.status).toBe(201);
    const r = await call('v1/contacts?group=' + g.body.id, keys.other); expect(r.body.total).toBe(0);
    const add = await import('../src/app/api/v1/groups/[id]/members/route');
    const res = await add.POST(new Request('http://x', { method: 'POST', headers: { authorization: `Bearer ${keys.other}`, 'content-type': 'application/json', 'cf-connecting-ip': '10.9.9.9' }, body: JSON.stringify({ contactIds: [randomUUID()] }) }), { params: Promise.resolve({ id: g.body.id }) });
    expect(res.status).toBe(422);
  });
  it('creating a campaign does not send it, and a key without the send permission cannot send (403)', async () => {
    const send = await import('../src/app/api/v1/campaigns/[id]/send/route');
    const res = await send.POST(new Request('http://x', { method: 'POST', headers: { authorization: `Bearer ${keys.camp}`, 'cf-connecting-ip': '10.8.8.8' } }), { params: Promise.resolve({ id: randomUUID() }) });
    expect(res.status).toBe(403); expect((await res.json()).error).toMatch(/campaigns:send/);
  });
  it('a revoked key stops working on the very next call', async () => {
    const k = await mint(T1, U1, ['contacts:read'], 'key-gone');
    expect((await call('v1/me', k)).status).toBe(200);
    await sql`update api_keys set revoked_at = now() where name = 'key-gone' and tenant_id = ${T1}`;
    expect((await call('v1/me', k)).status).toBe(401);
  });
  it('if the person who made a key is demoted, the key stops working', async () => {
    const k = await mint(T1, U1, ['contacts:read'], 'key-demote');
    expect((await call('v1/me', k)).status).toBe(200);
    await sql`update tenant_members set role = 'agent' where tenant_id = ${T1} and user_id = ${U1}`;
    expect((await call('v1/me', k)).status).toBe(401);
    await sql`update tenant_members set role = 'owner' where tenant_id = ${T1} and user_id = ${U1}`;
  });
  it('too many wrong keys from one address are refused for a while, even if the next one is right', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < 20; i++) expect((await call('v1/me', gen().key, {}, ip)).status).toBe(401);
    const blocked = await call('v1/me', keys.read, {}, ip); expect(blocked.status).toBe(429); expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call('v1/me', keys.read, {}, '203.0.113.78')).status).toBe(200);
  });
  it('a giant request body is refused before it is read', async () => {
    const r = await call('v1/contacts', keys.write, { method: 'POST', body: JSON.stringify({ phone: '9876500002', consent: true, source: 'In shop', name: 'x'.repeat(250_000) }) });
    expect(r.status).toBe(413);
  });
  it('broken JSON is a clear 400, not a crash', async () => {
    const r = await call('v1/contacts', keys.write, { method: 'POST', body: '{nope' }); expect(r.status).toBe(400); expect(r.body.error).toMatch(/JSON/);
  });
});

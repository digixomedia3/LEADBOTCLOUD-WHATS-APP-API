import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));

// Real database, real functions: this is the money path an AI agent uses, so it is tested end to end rather than mocked.
// The admin (setup/cleanup) connection is found the same way the database package's own tests find it. No silent skipping: if it cannot be found, the suite fails loudly.
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for tests');
const run = describe;

run('an API key starting sends (money rules)', () => {
  const tag = randomUUID().slice(0, 8);
  const T1 = randomUUID(), T2 = randomUUID(), U = `ck-${tag}`;
  let sql: postgres.Sql; let core: typeof import('@/lib/core/campaigns'); let tdb: typeof import('@/lib/tenant-db');
  const KEY_A = randomUUID(), KEY_B = randomUUID(), KEY_C = randomUUID();
  let tpl = '';
  const ctxFor = (tenant: string, keyId: string, capPaise: number) => ({
    user: { id: U, name: 'Owner', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role: 'owner' as const, plan: 'pro' }, role: 'owner' as const,
    via: { keyId, prefix: 'lbc_test0000', scopes: ['campaigns:send', 'campaigns:write'], sendCapPaise: capPaise },
  });
  const campaign = async (tenant: string, keyId: string | null, cost: number, status = 'draft') =>
    (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, est_cost_paise, counts, api_key_id) values (${tenant}, 'c', ${tpl}, '{}', ${status}, ${cost}, '{"audience":1}'::jsonb, ${keyId}) returning id`)[0]!.id as string;
  const state = async (id: string) => (await sql`select status, api_sent_at is not null as sent from campaigns where id = ${id}`)[0]!;

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 });
    core = await import('@/lib/core/campaigns'); tdb = await import('@/lib/tenant-db');
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${U}, 'u', ${U + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${T1}, ${'CK one ' + tag}), (${T2}, ${'CK two ' + tag})`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${T1}, ${U}, 'owner'), (${T2}, ${U}, 'owner')`;
    tpl = (await sql`insert into templates (tenant_id, name, language, category, status, body) values (${T1}, 'ck_t', 'en', 'marketing', 'approved', 'hello there friend') returning id`)[0]!.id;
    for (const [id, t, name] of [[KEY_A, T1, 'key-a'], [KEY_B, T1, 'key-b'], [KEY_C, T2, 'key-c']] as const) {
      const h = (await import('@lbc/shared/api-keys')).generateApiKey();
      await sql`insert into api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by) values (${id}, ${t}, ${name}, ${h.prefix}, ${h.hash}, ARRAY['campaigns:send','campaigns:write'], ${U})`;
    }
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id in (${T1}, ${T2})`;
    await sql`delete from tenants where id in (${T1}, ${T2})`;
    await sql`delete from "user" where id = ${U}`;
    await sql.end();
  });

  it('starts a campaign the key created, within its limit, and queues it', async () => {
    const id = await campaign(T1, KEY_A, 400);
    const r = await core.sendCampaignViaKey(ctxFor(T1, KEY_A, 500), id);
    expect(r).toMatchObject({ ok: true, data: { queued: 1, costPaise: 400, dailyUsedPaise: 400, dailyLimitPaise: 1500 } });
    expect(await state(id)).toMatchObject({ status: 'scheduled', sent: true });
  });
  it('refuses a send above the per-send limit and leaves the campaign untouched', async () => {
    const id = await campaign(T1, KEY_B, 501);
    const r = await core.sendCampaignViaKey(ctxFor(T1, KEY_B, 500), id);
    expect(r.ok).toBe(false); expect((r as { error: string }).error).toMatch(/above this key/);
    expect(await state(id)).toMatchObject({ status: 'draft', sent: false });
  });
  it('allows exactly the limit', async () => {
    const id = await campaign(T1, KEY_B, 500); expect((await core.sendCampaignViaKey(ctxFor(T1, KEY_B, 500), id)).ok).toBe(true);
  });
  it('a key cannot start a campaign it did not create (another key’s, a person’s, or nobody’s)', async () => {
    for (const owner of [KEY_A, null]) {
      const id = await campaign(T1, owner, 100);
      const r = await core.sendCampaignViaKey(ctxFor(T1, KEY_B, 500), id);
      expect(r.ok).toBe(false); expect((r as { error: string }).error).toMatch(/only start campaigns it created/);
      expect(await state(id)).toMatchObject({ status: 'draft', sent: false });
    }
  });
  it('a key cannot reach another workspace’s campaign, even by id', async () => {
    const id = await campaign(T2, KEY_C, 100);
    const r = await core.sendCampaignViaKey(ctxFor(T1, KEY_B, 500), id);
    expect(r.ok).toBe(false); expect((r as { error: string }).error).toMatch(/not found/);
    expect(await state(id)).toMatchObject({ status: 'draft', sent: false });
  });
  it('starting the same campaign twice queues it once and counts its cost once', async () => {
    const id = await campaign(T1, KEY_A, 300);
    const ctx = ctxFor(T1, KEY_A, 500);
    const used = async () => Number((await sql`select coalesce(sum(est_cost_paise),0)::bigint n from campaigns where api_key_id = ${KEY_A} and api_sent_at > now() - interval '24 hours'`)[0]!.n);
    const before = await used();
    expect((await core.sendCampaignViaKey(ctx, id)).ok).toBe(true);
    const second = await core.sendCampaignViaKey(ctx, id);
    expect(second.ok).toBe(false); expect((second as { error: string }).error).toMatch(/already/);
    expect(await used()).toBe(before + 300);
  });
  it('the 24-hour total stops a key splitting one big send into many small ones', async () => {
    const KEY = randomUUID(); const h = (await import('@lbc/shared/api-keys')).generateApiKey();
    await sql`insert into api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by) values (${KEY}, ${T1}, 'key-d', ${h.prefix}, ${h.hash}, ARRAY['campaigns:send','campaigns:write'], ${U})`;
    const ctx = ctxFor(T1, KEY, 100); // 100 paise per send, 300 paise per day
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push((await core.sendCampaignViaKey(ctx, await campaign(T1, KEY, 100))).ok);
    expect(results).toEqual([true, true, true, false, false]);
  });
  it('sends from the last 24 hours count, older ones do not', async () => {
    const KEY = randomUUID(); const h = (await import('@lbc/shared/api-keys')).generateApiKey();
    await sql`insert into api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by) values (${KEY}, ${T1}, 'key-e', ${h.prefix}, ${h.hash}, ARRAY['campaigns:send','campaigns:write'], ${U})`;
    const old = await campaign(T1, KEY, 300, 'completed'); await sql`update campaigns set api_sent_at = now() - interval '25 hours' where id = ${old}`;
    const recent = await campaign(T1, KEY, 300, 'completed'); await sql`update campaigns set api_sent_at = now() - interval '23 hours' where id = ${recent}`;
    const ctx = ctxFor(T1, KEY, 400); // day limit 1200
    expect((await core.sendCampaignViaKey(ctx, await campaign(T1, KEY, 400))).ok).toBe(true);   // 300 + 400 = 700
    expect((await core.sendCampaignViaKey(ctx, await campaign(T1, KEY, 400))).ok).toBe(true);   // 1100
    expect((await core.sendCampaignViaKey(ctx, await campaign(T1, KEY, 400))).ok).toBe(false);  // would be 1500
  });
  it('twenty sends fired at the same moment cannot get past the daily limit together', async () => {
    const KEY = randomUUID(); const h = (await import('@lbc/shared/api-keys')).generateApiKey();
    await sql`insert into api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by) values (${KEY}, ${T1}, 'key-f', ${h.prefix}, ${h.hash}, ARRAY['campaigns:send','campaigns:write'], ${U})`;
    const ctx = ctxFor(T1, KEY, 100); // 300 per day
    const ids = await Promise.all(Array.from({ length: 20 }, () => campaign(T1, KEY, 100)));
    const out = await Promise.all(ids.map((id) => core.sendCampaignViaKey(ctx, id)));
    expect(out.filter((r) => r.ok)).toHaveLength(3);
    expect(Number((await sql`select coalesce(sum(est_cost_paise),0)::bigint n from campaigns where api_key_id = ${KEY} and api_sent_at is not null`)[0]!.n)).toBe(300);
  });
  it('only an API key can use this path (the panel cannot)', async () => {
    const { via: _v, ...noKey } = ctxFor(T1, KEY_A, 500); void _v;
    expect((await core.sendCampaignViaKey(noKey as never, await campaign(T1, KEY_A, 100))).ok).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDb, withTenant, withUser } from '../src';
import { generateApiKey } from '@lbc/shared/api-keys';

const src = readFileSync(new URL('./rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const app = createDb(process.env.DATABASE_URL ?? pick(/const APP_URL = process\.env\.DATABASE_URL \?\? '([^']+)'/), { max: 3 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const u = admin.client.unsafe;
const tag = randomUUID().slice(0, 8);
const T1 = randomUUID(), T2 = randomUUID();
const OWNER1 = `ak-${tag}-o1`, ADMIN1 = `ak-${tag}-a1`, AGENT1 = `ak-${tag}-g1`, OWNER2 = `ak-${tag}-o2`;
const rows = (tx: any, q: any) => tx.execute(q) as Promise<any[]>;
const asTenant = <T,>(t: string, who: string, fn: (tx: any) => Promise<T>) => withTenant(app.db, { tenantId: t, userId: who }, fn);
const resolve = async (key: string) => (await withUser(app.db, '00000000-0000-0000-0000-000000000000', (tx) => rows(tx, sql`select * from public.resolve_api_key(${key})`)));
const mint = async (tenant: string, by: string, over: Record<string, string> = {}) => {
  const k = generateApiKey();
  const id = (await u(`insert into api_keys (tenant_id, name, prefix, key_hash, scopes, created_by ${over.extraCols ?? ''}) values ('${tenant}', 'agent', '${k.prefix}', '${k.hash}', ${over.scopes ?? "ARRAY['contacts:read','campaigns:send']"}, '${by}' ${over.extraVals ?? ''}) returning id`))[0]!.id as string;
  return { ...k, id };
};

beforeAll(async () => {
  for (const id of [OWNER1, ADMIN1, AGENT1, OWNER2]) await u(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('${id}', '${id}', '${id}@example.com', true, now(), now())`);
  await u(`insert into tenants (id, name) values ('${T1}', 'AK one ${tag}'), ('${T2}', 'AK two ${tag}')`);
  await u(`insert into tenant_members (tenant_id, user_id, role) values ('${T1}', '${OWNER1}', 'owner'), ('${T1}', '${ADMIN1}', 'admin'), ('${T1}', '${AGENT1}', 'agent'), ('${T2}', '${OWNER2}', 'owner')`);
});
afterAll(async () => {
  await u(`delete from audit_log where tenant_id in ('${T1}','${T2}')`);
  await u(`delete from tenants where id in ('${T1}','${T2}')`);
  await u(`delete from "user" where id in ('${OWNER1}','${ADMIN1}','${AGENT1}','${OWNER2}')`);
  await Promise.all([app.client.end(), admin.client.end()]);
});

describe('looking a key up', () => {
  it('a good key resolves to its workspace, its creator, its permissions and its money limit', async () => {
    const k = await mint(T1, OWNER1);
    const r = (await resolve(k.hash))[0];
    expect(r).toMatchObject({ key_id: k.id, tenant_id: T1, user_id: OWNER1, role: 'owner', prefix: k.prefix, send_cap_paise: 50000 });
    expect(r.scopes).toEqual(['contacts:read', 'campaigns:send']);
  });
  it('an unknown key, or the raw key instead of its hash, resolves to nothing', async () => {
    const k = await mint(T1, OWNER1);
    expect(await resolve(generateApiKey().hash)).toHaveLength(0);
    expect(await resolve(k.key)).toHaveLength(0);
    expect(await resolve('')).toHaveLength(0);
    expect(await resolve("x' or '1'='1")).toHaveLength(0);
  });
  it('a revoked key stops working at once', async () => {
    const k = await mint(T1, OWNER1); expect(await resolve(k.hash)).toHaveLength(1);
    await u(`update api_keys set revoked_at = now() where id = '${k.id}'`);
    expect(await resolve(k.hash)).toHaveLength(0);
  });
  it('an expired key does not work, a key with a future expiry does', async () => {
    const past = await mint(T1, OWNER1, { extraCols: ', expires_at', extraVals: ", now() - interval '1 minute'" });
    const future = await mint(T1, OWNER1, { extraCols: ', expires_at', extraVals: ", now() + interval '1 day'" });
    expect(await resolve(past.hash)).toHaveLength(0); expect(await resolve(future.hash)).toHaveLength(1);
  });
  it('a key whose creator is only an agent, or is no longer in the workspace, does not work: a key can never be more powerful than its maker', async () => {
    const byAgent = await mint(T1, AGENT1); expect(await resolve(byAgent.hash)).toHaveLength(0);
    const byAdmin = await mint(T1, ADMIN1); expect((await resolve(byAdmin.hash))[0].role).toBe('admin');
    await u(`delete from tenant_members where tenant_id = '${T1}' and user_id = '${ADMIN1}'`);
    expect(await resolve(byAdmin.hash)).toHaveLength(0);
    await u(`insert into tenant_members (tenant_id, user_id, role) values ('${T1}', '${ADMIN1}', 'admin')`);
    expect(await resolve(byAdmin.hash)).toHaveLength(1);
    await u(`update tenant_members set role = 'agent' where tenant_id = '${T1}' and user_id = '${ADMIN1}'`);
    expect(await resolve(byAdmin.hash)).toHaveLength(0);
    await u(`update tenant_members set role = 'admin' where tenant_id = '${T1}' and user_id = '${ADMIN1}'`);
  });
  it('a suspended or offboarded workspace\'s keys stop working; pending and ready ones work', async () => {
    const k = await mint(T2, OWNER2);
    for (const s of ['suspended', 'offboarded']) { await u(`update tenants set status = '${s}' where id = '${T2}'`); expect(await resolve(k.hash), s).toHaveLength(0); }
    for (const s of ['pending_meta', 'onboarding', 'ready']) { await u(`update tenants set status = '${s}' where id = '${T2}'`); expect(await resolve(k.hash), s).toHaveLength(1); }
  });
  it('using a key records when, at most once a minute', async () => {
    const k = await mint(T1, OWNER1);
    expect((await u(`select last_used_at from api_keys where id = '${k.id}'`))[0]!.last_used_at).toBeNull();
    await resolve(k.hash);
    const first = String((await u(`select last_used_at::text as t from api_keys where id = '${k.id}'`))[0]!.t);
    expect(first).toBeTruthy();
    await resolve(k.hash);
    expect(String((await u(`select last_used_at::text as t from api_keys where id = '${k.id}'`))[0]!.t)).toBe(first);
  });
});

describe('keys are tenant data, with hard limits on what the panel can change', () => {
  it('each workspace sees only its own keys, and can not read a key hash from another', async () => {
    const a = await mint(T1, OWNER1), b = await mint(T2, OWNER2);
    const mine = (await asTenant(T1, OWNER1, (tx) => rows(tx, sql`select id from api_keys`))).map((r) => r.id);
    expect(mine).toContain(a.id); expect(mine).not.toContain(b.id);
    expect(await asTenant(T1, OWNER1, (tx) => rows(tx, sql`select id from api_keys where id = ${b.id}::uuid`))).toHaveLength(0);
  });
  it('a workspace cannot create a key for another workspace', async () => {
    const k = generateApiKey();
    await expect(asTenant(T1, OWNER1, (tx) => tx.execute(sql`insert into api_keys (tenant_id, name, prefix, key_hash, scopes, created_by) values (${T2}::uuid, 'x', ${k.prefix}, ${k.hash}, ARRAY['contacts:read'], ${OWNER1})`))).rejects.toThrow();
  });
  it('the panel can rename and revoke, but can not widen permissions, raise the limit, move the key, or un-revoke it', async () => {
    const k = await mint(T1, OWNER1);
    await asTenant(T1, OWNER1, (tx) => tx.execute(sql`update api_keys set name = 'renamed' where id = ${k.id}::uuid`));
    for (const col of ["scopes = ARRAY['campaigns:send','contacts:write']", 'send_cap_paise = 99999999', `tenant_id = '${T2}'`, "key_hash = repeat('a', 64)", 'expires_at = null', `created_by = '${ADMIN1}'`])
      await expect(asTenant(T1, OWNER1, (tx) => tx.execute(sql.raw(`update api_keys set ${col} where id = '${k.id}'`))), col).rejects.toThrow();
    await asTenant(T1, OWNER1, (tx) => tx.execute(sql`update api_keys set revoked_at = now() where id = ${k.id}::uuid`));
    await expect(asTenant(T1, OWNER1, (tx) => tx.execute(sql`update api_keys set revoked_at = null where id = ${k.id}::uuid`))).rejects.toThrow(/revoked key cannot be restored/);
    expect(await resolve(k.hash)).toHaveLength(0);
  });
  it('the panel can not delete keys (revoking leaves a record)', async () => {
    const k = await mint(T1, OWNER1);
    await expect(asTenant(T1, OWNER1, (tx) => tx.execute(sql`delete from api_keys where id = ${k.id}::uuid`))).rejects.toThrow();
  });
  it('the database refuses a malformed key: unknown permission, no permission, bad prefix, bad hash, absurd limit', async () => {
    const bad = (vals: string) => u(`insert into api_keys (tenant_id, name, prefix, key_hash, scopes, created_by ${vals.includes('cap=') ? ', send_cap_paise' : ''}) values ('${T1}', 'x', ${vals})`);
    const h = generateApiKey().hash;
    await expect(bad(`'lbc_12345678', '${h}', ARRAY['admin:everything'], '${OWNER1}'`)).rejects.toThrow();
    await expect(bad(`'lbc_12345678', '${h}', ARRAY[]::text[], '${OWNER1}'`)).rejects.toThrow();
    await expect(bad(`'nope', '${h}', ARRAY['contacts:read'], '${OWNER1}'`)).rejects.toThrow();
    await expect(bad(`'lbc_12345678', 'short', ARRAY['contacts:read'], '${OWNER1}'`)).rejects.toThrow();
    await expect(bad(`'lbc_12345678', '${h}', ARRAY['contacts:read'], '${OWNER1}', -1 /*cap=*/`)).rejects.toThrow();
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));

/**
 * AI agents and "test first, then send the winner": create a test with a key, start it with a key, read the report, choose the winner with a key.
 * Real keys, real database, real route handlers and the real MCP server. Choosing a winner sends to customers, so the money rules are the point.
 */
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for tests');

describe('API: A/B tests and sending the winner', () => {
  const tag = randomUUID().slice(0, 8);
  const T1 = randomUUID(), T2 = randomUUID(), U1 = `aw-${tag}-1`, U2 = `aw-${tag}-2`;
  let sql: postgres.Sql; let grp = '', tA = '', tB = '', tOther = '';
  const keys: Record<string, string> = {}; const keyIds: Record<string, string> = {};
  const call = async (path: string, key: string | null, init: RequestInit = {}, params: Record<string, string> = {}) => {
    const mod = await import(`../src/app/api/${path}/route`);
    const headers = new Headers(init.headers); if (key) headers.set('authorization', `Bearer ${key}`); headers.set('cf-connecting-ip', `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const res: Response = await mod[(init.method ?? 'GET').toUpperCase()](new Request('http://x/api/x', { ...init, headers }), { params: Promise.resolve(params) });
    const text = await res.text(); let body: any = text; try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body };
  };
  const mint = async (tenant: string, user: string, scopes: string[], name: string, capPaise = 100_000) => {
    const g = (await import('@lbc/shared/api-keys')).generateApiKey(); const id = randomUUID();
    await sql`insert into api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by, send_cap_paise) values (${id}, ${tenant}, ${name}, ${g.prefix}, ${g.hash}, ${sql.array(scopes)}, ${user}, ${capPaise})`;
    keyIds[name] = id; return g.key;
  };
  const body = (extra: Record<string, unknown> = {}) => ({ name: 'AW ' + Math.random().toString(36).slice(2, 7), templateId: tA, groupIds: [grp], when: 'now', varMap: ['@name'], abTemplateId: tB, abVarMap: ['@name'], abHoldRest: true, abTestPct: 30, ...extra });
  const create = async (key: string, extra: Record<string, unknown> = {}) => call('v1/campaigns', key, { method: 'POST', body: JSON.stringify(body(extra)) });
  const winner = (key: string, id: string, version: unknown) => call('v1/campaigns/[id]/winner', key, { method: 'POST', body: JSON.stringify({ version }) }, { id });
  const start = (key: string, id: string) => call('v1/campaigns/[id]/send', key, { method: 'POST' }, { id });
  /** What the worker would have done: test people sent, the rest held. */
  const launched = async (id: string, o: { testStates?: string[]; held?: number } = {}) => {
    let i = 0; for (const st of o.testStates ?? ['delivered', 'read', 'sent', 'delivered']) {
      const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T1}, ${'+9198' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'X', 'allowed') returning id`)[0]!.id;
      await sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, version, phase) values (${T1}, ${id}, ${c}, '+919800000000', 'X', ${st}, ${i++ % 2 ? 'b' : 'a'}, 'test')`;
    }
    for (let k = 0; k < (o.held ?? 5); k++) {
      const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T1}, ${'+9197' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'H', 'allowed') returning id`)[0]!.id;
      await sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, version, phase) values (${T1}, ${id}, ${c}, '+919800000001', 'H', 'held', 'a', 'rest')`;
    }
    await sql`update campaigns set status = 'running' where id = ${id}`;
  };
  const row = async (id: string) => (await sql`select ab_hold_rest, ab_test_pct, ab_percent_b, ab_release_version, ab_release_requested_by, api_key_id, api_sent_at, status from campaigns where id = ${id}`)[0]!;
  /** A campaign this key made and started, then launched by the worker. */
  const ready = async (key: string, extra: Record<string, unknown> = {}, o: { testStates?: string[]; held?: number } = {}) => {
    const r = await create(key, extra); if (r.status !== 201) throw new Error('create failed: ' + JSON.stringify(r.body));
    const s = await start(key, r.body.id); if (s.status !== 200) throw new Error('start failed: ' + JSON.stringify(s.body));
    await sql`update campaigns set status = 'draft' where id = ${r.body.id}`; await launched(r.body.id, o); return r.body.id as string;
  };

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 });
    for (const u of [U1, U2]) await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, ${u}, ${u + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name, plan_id) values (${T1}, ${'AW one ' + tag}, 'pro'), (${T2}, ${'AW two ' + tag}, 'pro')`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${T1}, ${U1}, 'owner'), (${T2}, ${U2}, 'owner')`;
    const mk = async (t: string, n: string, bodyTxt: string) => (await sql`insert into templates (tenant_id, name, language, category, status, body) values (${t}, ${n + '_' + tag}, 'en', 'marketing', 'approved', ${bodyTxt}) returning id`)[0]!.id as string;
    tA = await mk(T1, 'aw_a', 'Hi {{1}}, sale on.'); tB = await mk(T1, 'aw_b', 'Hi {{1}}! Big sale, 20% off.'); tOther = await mk(T2, 'aw_other', 'Hi {{1}}, other shop.');
    grp = (await sql`insert into contact_groups (tenant_id, name) values (${T1}, 'g') returning id`)[0]!.id;
    for (let i = 0; i < 10; i++) { const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T1}, ${'+9196' + String(10000000 + i)}, ${'P' + i}, 'allowed') returning id`)[0]!.id; await sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${T1}, ${grp}, ${c})`; }
    keys.full = await mint(T1, U1, ['campaigns:read', 'campaigns:write', 'campaigns:send'], 'full');
    keys.other = await mint(T1, U1, ['campaigns:read', 'campaigns:write', 'campaigns:send'], 'otherkey');
    keys.noSend = await mint(T1, U1, ['campaigns:read', 'campaigns:write'], 'nosend');
    keys.readOnly = await mint(T1, U1, ['campaigns:read'], 'readonly');
    keys.stranger = await mint(T2, U2, ['campaigns:read', 'campaigns:write', 'campaigns:send'], 'stranger');
    keys.tiny = await mint(T1, U1, ['campaigns:read', 'campaigns:write', 'campaigns:send'], 'tiny', 100);
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id in (${T1}, ${T2})`; await sql`delete from tenants where id in (${T1}, ${T2})`; await sql`delete from "user" where id in (${U1}, ${U2})`;
    const left = Number((await sql`select count(*)::int n from tenants where id in (${T1}, ${T2})`)[0]!.n); await sql.end(); if (left) throw new Error('agent winner test left workspaces behind');
  });

  describe('creating a test with a key', () => {
    it('saves a "test first" campaign exactly like the panel does, made by this key, and it sends nothing', async () => {
      const r = await create(keys.full!); expect(r.status).toBe(201); expect(r.body.audience).toBe(10);
      expect(await row(r.body.id)).toMatchObject({ ab_hold_rest: true, ab_test_pct: 30, ab_percent_b: 50, api_key_id: keyIds.full, api_sent_at: null, status: 'draft' });
      expect(Number((await sql`select count(*)::int n from messages where tenant_id = ${T1}`)[0]!.n)).toBe(0);
    });
    it('a plain even-split test (no holding back) works through the key too', async () => {
      const r = await create(keys.full!, { abHoldRest: undefined, abTestPct: undefined, abPercentB: 40 }); expect(r.status).toBe(201);
      expect(await row(r.body.id)).toMatchObject({ ab_hold_rest: false, ab_percent_b: 40 });
    });
    it('refuses the same unsafe settings the panel refuses, and saves nothing', async () => {
      const before = Number((await sql`select count(*)::int n from campaigns where tenant_id = ${T1}`)[0]!.n);
      for (const [why, extra, msg] of [
        ['hold without a second template', { abTemplateId: undefined, abVarMap: undefined }, /second template/], ['hold without a share', { abTestPct: undefined }, /how many people/],
        ['share over half', { abTestPct: 60 }, /at most half/], ['share under 10', { abTestPct: 5 }, /at least 10%/], ['a second template of another workspace', { abTemplateId: tOther }, /not found/],
        ['same template twice', { abTemplateId: tA }, /different/], ['repeating test', { repeat: 'daily' }, /cannot repeat/],
      ] as const) { const r = await create(keys.full!, extra as Record<string, unknown>); expect(r.status, why).toBe(422); expect(String(r.body.error), why).toMatch(msg); }
      expect(Number((await sql`select count(*)::int n from campaigns where tenant_id = ${T1}`)[0]!.n)).toBe(before);
    });
    it('a read-only key cannot create one', async () => { expect((await create(keys.readOnly!)).status).toBe(403); });
  });

  describe('sending the winner with a key', () => {
    it('sends the chosen version, records the key (not a person), and asks the worker to act; audit says it was the API', async () => {
      const id = await ready(keys.full!); const r = await winner(keys.full!, id, 'b'); expect(r).toMatchObject({ status: 200, body: { held: 5 } });
      expect(await row(id)).toMatchObject({ ab_release_version: 'b', ab_release_requested_by: U1 });
      const [l] = await sql`select action, after from audit_log where tenant_id = ${T1} and entity_id = ${id} and action like '%ab_release_requested'`; expect(l!.action).toBe('api.campaign.ab_release_requested'); expect(l!.after).toMatchObject({ version: 'b', held: 5 });
      expect((l!.after as { viaKey: string }).viaKey).toMatch(/^lbc_/);
    });
    it('needs the send permission: a write-only key and a read-only key get 403 and nothing happens', async () => {
      const id = await ready(keys.full!); for (const k of [keys.noSend!, keys.readOnly!]) expect((await winner(k, id, 'a')).status).toBe(403);
      expect((await row(id)).ab_release_version).toBeNull();
    });
    it('no key, or a wrong key, gets 401', async () => {
      const id = await ready(keys.full!); expect((await winner(null, id, 'a')).status).toBe(401); expect((await winner('lbc_notarealkeynotarealkey', id, 'a')).status).toBe(401);
    });
    it('only the key that created AND started the campaign may choose: another key of the same workspace is refused', async () => {
      const id = await ready(keys.full!); const r = await winner(keys.other!, id, 'a'); expect(r.status).toBe(422); expect(r.body.error).toMatch(/created itself/); expect((await row(id)).ab_release_version).toBeNull();
    });
    it('a campaign made by a person in the panel (no key) cannot be released by a key', async () => {
      const id = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, ab_template_id, ab_var_map, ab_percent_b, ab_hold_rest, ab_test_pct, counts) values (${T1}, 'panel one', ${tA}, '{}', 'running', ${tB}, '["@name"]'::jsonb, 50, true, 30, '{"audience":10}'::jsonb) returning id`)[0]!.id; await launched(id);
      const r = await winner(keys.full!, id, 'a'); expect(r.status).toBe(422); expect(r.body.error).toMatch(/created itself/);
    });
    it('a key that made the campaign but never started it cannot release it: its cost was never counted against the key\'s limits', async () => {
      const c = await create(keys.full!); await sql`update campaigns set status = 'running' where id = ${c.body.id}`; await launched(c.body.id);
      const r = await winner(keys.full!, c.body.id, 'a'); expect(r.status).toBe(422); expect(r.body.error).toMatch(/has not started this campaign/); expect((await row(c.body.id)).ab_release_version).toBeNull();
    });
    it('another workspace\'s key cannot see or release it', async () => {
      const id = await ready(keys.full!); const r = await winner(keys.stranger!, id, 'a'); expect(r.status).toBe(422); expect(r.body.error).toMatch(/not found/); expect((await row(id)).ab_release_version).toBeNull();
    });
    it('only "a" or "b" is accepted, and a bad id is refused', async () => {
      const id = await ready(keys.full!); for (const v of ['c', 'A', '', null, 1, undefined, ['a']]) { const r = await winner(keys.full!, id, v); expect(r.status, String(v)).toBe(422); expect(r.body.error, String(v)).toMatch(/Send \{"version": "a"\} or \{"version": "b"\}/); }       // the route's own plain instruction, not a deeper message
      expect((await winner(keys.full!, 'not-a-uuid', 'a')).status).toBe(422);
      expect((await call('v1/campaigns/[id]/winner', keys.full!, { method: 'POST', body: '{broken' }, { id })).status).toBe(400);
      expect((await row(id)).ab_release_version).toBeNull();
    });
    it('works once only: a second call, even concurrently, changes nothing more', async () => {
      const id = await ready(keys.full!); const rs = await Promise.all([winner(keys.full!, id, 'a'), winner(keys.full!, id, 'b'), winner(keys.full!, id, 'a')]);
      expect(rs.filter((r) => r.status === 200).length).toBe(1); expect(rs.filter((r) => r.status === 422).length).toBe(2);
      expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${T1} and entity_id = ${id} and action = 'api.campaign.ab_release_requested'`)[0]!.n)).toBe(1);
    });
    it('is refused while test messages are still going out, with nothing to compare, or for a campaign not set up to hold people', async () => {
      const a = await ready(keys.full!, {}, { testStates: ['sent', 'queued', 'delivered', 'retry_wait'] }); const r1 = await winner(keys.full!, a, 'a'); expect(r1.status).toBe(422); expect(r1.body.error).toMatch(/still being sent/);
      const b = await ready(keys.full!, {}, { testStates: ['skipped', 'skipped'] }); expect((await winner(keys.full!, b, 'a')).body.error).toMatch(/nothing to compare/);
      const plain = await create(keys.full!, { abHoldRest: undefined, abTestPct: undefined, abPercentB: 50 }); await start(keys.full!, plain.body.id); await sql`update campaigns set status = 'running' where id = ${plain.body.id}`;
      expect((await winner(keys.full!, plain.body.id, 'a')).body.error).toMatch(/not set up/);
    });
    it('adds no spend: sending the winner changes neither the campaign\'s cost figure nor the key\'s 24-hour total', async () => {
      const id = await ready(keys.full!); const before = await sql`select est_cost_paise, api_sent_at from campaigns where id = ${id}`; const used = async () => Number((await sql`select coalesce(sum(est_cost_paise), 0)::bigint s from campaigns where api_key_id = ${keyIds.full} and api_sent_at > now() - interval '24 hours'`)[0]!.s);
      const u0 = await used(); expect((await winner(keys.full!, id, 'a')).status).toBe(200);
      const after = await sql`select est_cost_paise, api_sent_at from campaigns where id = ${id}`; expect(after[0]!.est_cost_paise).toBe(before[0]!.est_cost_paise); expect(after[0]!.api_sent_at).toEqual(before[0]!.api_sent_at); expect(await used()).toBe(u0);
    });
  });

  describe('the function itself, called directly (not through the route)', () => {
    const ctx = (keyId: string | null, scopes = ['campaigns:send']) => ({ user: { id: U1, name: 'O', email: '' }, tenantId: T1, workspace: { tenantId: T1, name: 'x', role: 'owner' as const, plan: 'pro' }, role: 'owner' as const, ...(keyId ? { via: { keyId, prefix: 'lbc_direct00', scopes, sendCapPaise: 100_000 } } : {}) });
    it('refuses anything that is not an API key, a bad version, or a bad id, before touching the database', async () => {
      const core = await import('../src/lib/core/campaigns'); const id = await ready(keys.full!);
      expect((await core.releaseWinnerViaKey(ctx(null), id, 'a')).ok).toBe(false);
      for (const v of ['c', '', 'A', null, undefined] as never[]) { const r = await core.releaseWinnerViaKey(ctx(keyIds.full!), id, v); expect(r.ok, String(v)).toBe(false); }
      for (const bad of ['nope', '', '1; drop table campaigns']) { const r = await core.releaseWinnerViaKey(ctx(keyIds.full!), bad, 'a'); expect(r.ok, bad).toBe(false); if (!r.ok) expect(r.error).toMatch(/not valid/); }
      expect((await row(id)).ab_release_version).toBeNull();
    });
    it('the panel function refuses a bad version too, so neither door depends on the other', async () => {
      const core = await import('../src/lib/core/campaigns'); const id = await ready(keys.full!);
      expect((await core.releaseWinnerFor(ctx(null) as never, id, 'c' as never)).ok).toBe(false); expect((await row(id)).ab_release_version).toBeNull();
    });
    it('once the winner is sent, asking again is refused with the plain reason, whichever door is used', async () => {
      const core = await import('../src/lib/core/campaigns'); const id = await ready(keys.full!);
      await sql`update campaigns set ab_release_version = 'a', ab_release_requested_at = now(), ab_released_at = now() where id = ${id}`;
      const viaKey = await core.releaseWinnerViaKey(ctx(keyIds.full!), id, 'b'); expect(viaKey.ok).toBe(false); if (!viaKey.ok) expect(viaKey.error).toMatch(/already been sent/);
      const viaPanel = await core.releaseWinnerFor(ctx(null) as never, id, 'b'); expect(viaPanel.ok).toBe(false); if (!viaPanel.ok) expect(viaPanel.error).toMatch(/already been sent/);
      expect((await row(id)).ab_release_version).toBe('a');
    });
  });

  describe('starting the test counts the WHOLE audience against the key\'s limits', () => {
    it('a key whose per-send limit is smaller than the full audience\'s cost cannot start it, so it can never reach the winner step', async () => {
      const r = await create(keys.tiny!); expect(r.status).toBe(201);       // the estimate covers all 10 people, test group and held group alike
      expect(r.body.estCostPaise).toBeGreaterThan(100);
      const s = await start(keys.tiny!, r.body.id); expect(s.status).toBe(422); expect(s.body.error).toMatch(/above this key/);
      await sql`update campaigns set status = 'running' where id = ${r.body.id}`; await launched(r.body.id);
      expect((await winner(keys.tiny!, r.body.id, 'a')).body.error).toMatch(/has not started/);
    });
  });

  describe('the report an agent reads before choosing', () => {
    it('shows who is kept back, whether the test is done, and a suggestion only when the evidence supports one', async () => {
      const id = await ready(keys.full!, {}, { testStates: ['delivered', 'read', 'sent', 'delivered'], held: 6 });
      const r = await call('v1/campaigns/[id]/report', keys.full!, {}, { id }); expect(r.status).toBe(200);
      expect(r.body.abTest.hold).toMatchObject({ held: 6, testPct: 30, testDone: true, suggested: null, releasedVersion: null, releaseWaiting: false });
      expect(r.body.outcomes.find((o: { label: string }) => o.label === 'Kept back until you pick a winner').count).toBe(6);
      await winner(keys.full!, id, 'a'); const after = await call('v1/campaigns/[id]/report', keys.full!, {}, { id }); expect(after.body.abTest.hold.releaseWaiting).toBe(true);
    });
  });

  describe('the MCP tools', () => {
    const setup = async (key: string) => {
      const { buildServer } = await import('../src/lib/mcp-server'); const { authenticate } = await import('../src/lib/api-auth');
      const a = await authenticate(new Headers({ authorization: `Bearer ${key}` }), `10.2.${Math.floor(Math.random() * 250)}.1`); if (!a.ok) throw new Error('auth ' + a.error);
      return buildServer(a.ctx) as unknown as { _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>; inputSchema?: { safeParse?: (x: unknown) => { success: boolean } } }> };
    };
    it('only a key with the send permission is even shown send_winner; create_campaign shows the A/B fields', async () => {
      const full = await setup(keys.full!), noSend = await setup(keys.noSend!), ro = await setup(keys.readOnly!);
      expect(Object.keys(full._registeredTools)).toContain('send_winner'); expect(Object.keys(noSend._registeredTools)).not.toContain('send_winner'); expect(Object.keys(ro._registeredTools)).not.toContain('send_winner');
      const shape = JSON.stringify(Object.keys((full._registeredTools.create_campaign as any).inputSchema?.shape ?? (full._registeredTools.create_campaign as any).inputSchema ?? {})); expect(shape).toMatch(/abHoldRest/); expect(shape).toMatch(/abTestPct/);
    });
    it('send_winner works through the tool, and needs userConfirmed to be true', async () => {
      const id = await ready(keys.full!); const t = await setup(keys.full!); const tool = t._registeredTools.send_winner!;
      const ok = await tool.handler({ campaignId: id, version: 'a', userConfirmed: true }, {}); expect(ok.isError).toBeFalsy(); expect(ok.content[0]!.text).toMatch(/held/);
      expect((await row(id)).ab_release_version).toBe('a');
      const again = await tool.handler({ campaignId: id, version: 'b', userConfirmed: true }, {}); expect(again.isError).toBe(true);
    });

    it('the tool refuses to run without the user\'s confirmation, and only accepts version a or b', async () => {
      const t = await setup(keys.full!); const tool = t._registeredTools.send_winner as any;
      const schema = tool.inputSchema; const parse = (x: unknown) => (schema.safeParse ? schema.safeParse(x) : { success: false }).success as boolean;
      const id = randomUUID(); expect(parse({ campaignId: id, version: 'a', userConfirmed: true })).toBe(true);
      expect(parse({ campaignId: id, version: 'a', userConfirmed: false })).toBe(false); expect(parse({ campaignId: id, version: 'a' })).toBe(false);
      expect(parse({ campaignId: id, version: 'c', userConfirmed: true })).toBe(false); expect(parse({ campaignId: 'nope', version: 'a', userConfirmed: true })).toBe(false);
    });
    it('create_campaign lists exactly the A/B fields, spelled correctly', async () => {
      const t = await setup(keys.full!); const tool = t._registeredTools.create_campaign as any; const shape = tool.inputSchema?.shape ?? tool.inputSchema ?? {};
      for (const f of ['abTemplateId', 'abVarMap', 'abPercentB', 'abHoldRest', 'abTestPct']) expect(Object.keys(shape), f).toContain(f);
      expect(Object.keys(shape)).not.toContain('abHoldRestX');
    });
    it('the handler checks the send permission again at call time: if the permission is gone after the tool was listed, the call is refused for that reason', async () => {
      const { buildServer } = await import('../src/lib/mcp-server'); const { authenticate } = await import('../src/lib/api-auth');
      const a = await authenticate(new Headers({ authorization: `Bearer ${keys.full}` }), `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`); if (!a.ok) throw new Error('auth');
      const id = await ready(keys.full!);
      const scopes = a.ctx.via!.scopes;                                   // the same list the server reads
      const srv = buildServer(a.ctx) as unknown as { _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> };
      expect(srv._registeredTools.send_winner).toBeDefined();
      scopes.splice(0, scopes.length, 'campaigns:read', 'campaigns:write');       // the key loses the send permission after the tool was listed
      const r = await srv._registeredTools.send_winner!.handler({ campaignId: id, version: 'a', userConfirmed: true }, {});
      expect(r.isError).toBe(true); expect(r.content[0]!.text).toMatch(/does not have the "campaigns:send" permission/);
      expect((await row(id)).ab_release_version).toBeNull();
    });
    it('a key without the send permission has no way to call the tool by name either', async () => {
      const t = await setup(keys.noSend!); expect(t._registeredTools.send_winner).toBeUndefined();
    });
  });
});

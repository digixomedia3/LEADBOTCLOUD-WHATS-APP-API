import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for tests');

describe('A/B test: keep the rest back and send the winner (web rules and report)', () => {
  const tag = randomUUID().slice(0, 8);
  const T = randomUUID(), OTHER = randomUUID(), U = `ab-${tag}`;
  let sql: postgres.Sql; let grp = '';
  const t: Record<string, string> = {};
  const ctx = () => ({ user: { id: U, name: 'U', email: '' }, tenantId: T, workspace: { tenantId: T, name: 'x', role: 'owner' as const, plan: 'pro' }, role: 'owner' as const });
  const core = () => import('@/lib/core/campaigns');
  const rep = () => import('@/lib/core/campaign-report');
  const mk = async (key: string, o: { category?: string; status?: string; body?: string; buttons?: object[]; offer?: object | null; tenant?: string } = {}) => {
    const x = await sql`insert into templates (tenant_id, name, language, category, status, body, buttons, offer) values (${o.tenant ?? T}, ${'ab_' + key + '_' + tag}, 'en', ${o.category ?? 'marketing'}, ${o.status ?? 'approved'}, ${o.body ?? 'Hello {{1}}, news.'}, ${sql.json((o.buttons ?? []) as never)}, ${o.offer ? sql.json(o.offer as never) : null}) returning id`;
    t[key] = x[0]!.id as string;
  };
  const base = (extra: Record<string, unknown> = {}) => ({ name: 'Test ' + Math.random().toString(36).slice(2, 7), templateId: t.a!, groupIds: [grp], when: 'now' as const, varMap: ['@name'], ...extra });
  const ab = (extra: Record<string, unknown> = {}) => base({ abTemplateId: t.b!, abVarMap: ['@name'], abPercentB: 50, ...extra });
  const row = async (id: string) => (await sql`select ab_template_id, ab_var_map, ab_percent_b, ab_hold_rest, ab_test_pct, ab_release_version, ab_release_requested_by, status from campaigns where id = ${id}`)[0]!;

  beforeAll(async () => {
    process.env.APP_URL = 'https://panel.example-company.in';
    sql = postgres(ADMIN, { max: 2 });
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${U}, 'u', ${U + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${T}, ${'HW web ' + tag}), (${OTHER}, ${'HW other ' + tag})`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${T}, ${U}, 'owner')`;
    grp = (await sql`insert into contact_groups (tenant_id, name) values (${T}, 'g') returning id`)[0]!.id;
    for (let i = 0; i < 6; i++) {
      const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T}, ${'+919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}, ${'P' + i}, 'allowed') returning id`)[0]!.id;
      await sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${T}, ${grp}, ${c})`;
    }
    await mk('a', {}); await mk('b', { body: 'Hi {{1}}, B.' });
    await mk('util', { category: 'utility' }); await mk('pending', { status: 'pending' }); await mk('novars', { body: 'No blanks here.' }); await mk('two', { body: 'Hi {{1}} and {{2}}.' });
    await mk('code', { buttons: [{ type: 'copy_code', value: 'x' }] }); await mk('count', { offer: { text: 'Hurry!', hasExpiration: true } });
    await mk('tracked', { body: 'Look, no blanks.', buttons: [{ type: 'url', value: 'https://panel.example-company.in/r/{{1}}' }] });
    await mk('theirs', { tenant: OTHER });
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id in (${T}, ${OTHER})`; await sql`delete from tenants where id in (${T}, ${OTHER})`; await sql`delete from "user" where id = ${U}`; await sql.end();
  });


  const hold = (extra: Record<string, unknown> = {}) => base({ abTemplateId: t.b!, abVarMap: ['@name'], abHoldRest: true, abTestPct: 30, ...extra });
  const made = async (extra: Record<string, unknown> = {}) => { const c = await core(); const r = await c.createCampaignFor(ctx(), hold(extra)); if (!r.ok) throw new Error(r.error); return r.data.id; };
  /** Puts a campaign in the state after launch: test people sent to, the rest held. */
  const afterLaunch = async (id: string, o: { testStates?: string[]; held?: number; status?: string } = {}) => {
    const test = o.testStates ?? ['delivered', 'read', 'sent', 'delivered']; let i = 0;
    for (const st of test) { const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T}, ${'+9198' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'X', 'allowed') returning id`)[0]!.id;
      await sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, version, phase) values (${T}, ${id}, ${c}, '+919800000000', 'X', ${st}, ${i++ % 2 ? 'b' : 'a'}, 'test')`; }
    for (let k = 0; k < (o.held ?? 5); k++) { const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T}, ${'+9197' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'H', 'allowed') returning id`)[0]!.id;
      await sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, version, phase) values (${T}, ${id}, ${c}, '+919800000001', 'H', 'held', 'a', 'rest')`; }
    await sql`update campaigns set status = ${o.status ?? 'running'} where id = ${id}`;
  };

  it('saves a campaign that tests first and keeps the rest back, with an even split', async () => {
    const id = await made(); expect(await row(id)).toMatchObject({ ab_hold_rest: true, ab_test_pct: 30, ab_percent_b: 50, ab_template_id: t.b });
  });
  it('a normal test and a normal campaign are unchanged and not held', async () => {
    const c = await core(); const n = await c.createCampaignFor(ctx(), ab({ abPercentB: 30 })); const p = await c.createCampaignFor(ctx(), base());
    expect(await row(n.ok ? n.data.id : '')).toMatchObject({ ab_hold_rest: false, ab_test_pct: null, ab_percent_b: 30 }); expect(await row(p.ok ? p.data.id : '')).toMatchObject({ ab_hold_rest: false, ab_test_pct: null });
  });
  it('refuses unclear or unsafe hold settings, saving nothing', async () => {
    const c = await core(); const before = Number((await sql`select count(*) from campaigns where tenant_id = ${T}`)[0]!.count);
    const bad: [string, Record<string, unknown>, RegExp][] = [
      ['hold without a second template', base({ abHoldRest: true, abTestPct: 20 }), /second template/],
      ['hold without a test share', hold({ abTestPct: undefined }), /how many people/],
      ['a test share without hold', ab({ abTestPct: 20 }), /only applies/],
      ['test share too small', hold({ abTestPct: 5 }), /at least 10%/],
      ['test share over half', hold({ abTestPct: 60 }), /at most half/],
      ['repeating test', hold({ repeat: 'daily' }), /cannot repeat/],
      ['same template', hold({ abTemplateId: t.a }), /must be different/],
    ];
    for (const [why, input, msg] of bad) { const r = await c.createCampaignFor(ctx(), input as never); expect(r.ok, why).toBe(false); if (!r.ok) expect(r.error, why).toMatch(msg); }
    expect(Number((await sql`select count(*) from campaigns where tenant_id = ${T}`)[0]!.count)).toBe(before);
  });
  it('needs at least 4 people so there is someone to send the winner to', async () => {
    const c = await core(); const g2 = (await sql`insert into contact_groups (tenant_id, name) values (${T}, 'three') returning id`)[0]!.id;
    for (let i = 0; i < 3; i++) { const k = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T}, ${'+9196' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'Q', 'allowed') returning id`)[0]!.id; await sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${T}, ${g2}, ${k})`; }
    const r = await c.createCampaignFor(ctx(), hold({ groupIds: [g2] })); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/at least 4 people/);
    const ok = await c.createCampaignFor(ctx(), ab({ groupIds: [g2] })); expect(ok.ok).toBe(true);        // an ordinary test on 3 people is still fine
  });

  describe('choosing the winner', () => {
    it('records the choice, who made it, and asks the worker to send; audit logged', async () => {
      const c = await core(); const id = await made(); await afterLaunch(id);
      const r = await c.releaseWinnerFor(ctx(), id, 'b'); expect(r).toEqual({ ok: true, data: { held: 5 } });
      expect(await row(id)).toMatchObject({ ab_release_version: 'b', ab_release_requested_by: U });
      const [l] = await sql`select after from audit_log where tenant_id = ${T} and action = 'campaign.ab_release_requested' and entity_id = ${id}`; expect(l!.after).toMatchObject({ version: 'b', held: 5 });
    });
    it('can only be chosen once, even by two people at the same moment', async () => {
      const c = await core(); const id = await made(); await afterLaunch(id);
      const rs = await Promise.all([c.releaseWinnerFor(ctx(), id, 'a'), c.releaseWinnerFor(ctx(), id, 'b'), c.releaseWinnerFor(ctx(), id, 'a')]);
      expect(rs.filter((x) => x.ok).length).toBe(1); expect(rs.find((x) => !x.ok && /already/.test(x.error))).toBeTruthy();
      const v = (await row(id)).ab_release_version; expect(['a', 'b']).toContain(v);
      const again = await c.releaseWinnerFor(ctx(), id, 'a'); expect(again.ok).toBe(false);
    });
    it('is refused after the winner was already sent', async () => {
      const c = await core(); const id = await made(); await afterLaunch(id); await sql`update campaigns set ab_release_version = 'a', ab_released_at = now() where id = ${id}`;
      const r = await c.releaseWinnerFor(ctx(), id, 'b'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/already been sent/);
    });
    it('is refused while test messages are still waiting to go out', async () => {
      const c = await core(); const id = await made(); await afterLaunch(id, { testStates: ['sent', 'queued', 'delivered', 'retry_wait'] });
      const r = await c.releaseWinnerFor(ctx(), id, 'a'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/still being sent/); expect((await row(id)).ab_release_version).toBeNull();
    });
    it('is refused when no test message went out at all (nothing to compare)', async () => {
      const c = await core(); const id = await made(); await afterLaunch(id, { testStates: ['skipped', 'skipped'] });
      const r = await c.releaseWinnerFor(ctx(), id, 'a'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/nothing to compare/);
    });
    it('is refused before launch, for draft, scheduled, paused and cancelled campaigns', async () => {
      const c = await core();
      for (const st of ['draft', 'scheduled', 'paused', 'cancelled']) { const id = await made(); await afterLaunch(id, { status: st }); const r = await c.releaseWinnerFor(ctx(), id, 'a'); expect(r.ok, st).toBe(false); if (!r.ok) expect(r.error).toMatch(/not been sent yet/); }
    });
    it('is refused when nobody is being kept back', async () => {
      const c = await core(); const id = await made(); await afterLaunch(id, { held: 0 }); const r = await c.releaseWinnerFor(ctx(), id, 'a'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/nobody to send/i);
    });
    it('is refused for a campaign that was never set up to hold people', async () => {
      const c = await core(); const r0 = await c.createCampaignFor(ctx(), ab()); const id = r0.ok ? r0.data.id : ''; await afterLaunch(id);
      const r = await c.releaseWinnerFor(ctx(), id, 'a'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/not set up/);
    });
    it('refuses a bad version or a bad id, and another workspace cannot see or release this campaign', async () => {
      const c = await core(); const id = await made(); await afterLaunch(id);
      expect((await c.releaseWinnerFor(ctx(), id, 'c' as never)).ok).toBe(false); expect((await c.releaseWinnerFor(ctx(), 'nope', 'a')).ok).toBe(false);
      const stranger = { ...ctx(), tenantId: OTHER, workspace: { tenantId: OTHER, name: 'o', role: 'owner' as const, plan: 'pro' } };
      const r = await c.releaseWinnerFor(stranger, id, 'a'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/not found/); expect((await row(id)).ab_release_version).toBeNull();
    });
  });

  describe('the report', () => {
    it('compares only the test group, never the people sent the winner later', async () => {
      const c = await core(); const id = await made(); await afterLaunch(id, { testStates: ['read', 'read', 'delivered', 'delivered'], held: 0 });
      for (let k = 0; k < 6; k++) { const ct = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T}, ${'+9195' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'W', 'allowed') returning id`)[0]!.id;
        await sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, version, phase) values (${T}, ${id}, ${ct}, '+919800000002', 'W', 'replied', 'b', 'rest')`; }
      const r = await (await rep()).campaignReportFor(ctx(), id); expect(r.ok).toBe(true); if (!r.ok) return;
      expect(r.data.abTest!.a.counts.received + r.data.abTest!.b.counts.received).toBe(4); expect(r.data.abTest!.b.counts.replied).toBe(0);     // the six "replied" winners are not in the comparison
    });
    it('shows held people as kept back, and offers a choice only once the test is done', async () => {
      const id = await made(); await afterLaunch(id, { testStates: ['sent', 'queued', 'delivered', 'delivered'] });
      let r = await (await rep()).campaignReportFor(ctx(), id); if (!r.ok) throw new Error(r.error);
      expect(r.data.abTest!.hold).toMatchObject({ held: 5, testPct: 30, testDone: false, releaseWaiting: false, releasedVersion: null });
      expect(r.data.outcomes.find((o) => o.label === 'Kept back until you pick a winner')!.count).toBe(5);
      await sql`update campaign_recipients set state = 'sent' where campaign_id = ${id} and state = 'queued'`;
      r = await (await rep()).campaignReportFor(ctx(), id); if (!r.ok) throw new Error(r.error); expect(r.data.abTest!.hold!.testDone).toBe(true);
    });
    it('reflects a requested release, a finished release and a refused one', async () => {
      const id = await made(); await afterLaunch(id); const get = async () => { const r = await (await rep()).campaignReportFor(ctx(), id); if (!r.ok) throw new Error(r.error); return r.data.abTest!.hold!; };
      await sql`update campaigns set ab_release_version = 'b', ab_release_requested_at = now() where id = ${id}`; expect(await get()).toMatchObject({ releaseWaiting: true, releasedVersion: null });
      await sql`update campaigns set ab_released_at = now() where id = ${id}`; expect(await get()).toMatchObject({ releaseWaiting: false, releasedVersion: 'b' });
      await sql`update campaigns set ab_release_version = null, ab_release_requested_at = null, ab_released_at = null, ab_release_error = 'spend_cap' where id = ${id}`; expect(await get()).toMatchObject({ releaseWaiting: false, releasedVersion: null, error: 'spend_cap' });
    });
    it('suggests a winner only when the evidence supports it', async () => {
      const id = await made(); const c = await core(); void c;
      const states: string[] = [...Array(70).fill('delivered'), ...Array(30).fill('read'), ...Array(60).fill('delivered'), ...Array(40).fill('replied')];
      const ids: string[] = []; for (let i = 0; i < states.length; i++) ids.push((await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T}, ${'+9194' + String(1000000 + i).padStart(8, '0')}, 'E', 'allowed') returning id`)[0]!.id);
      for (let i = 0; i < states.length; i++) await sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, version, phase) values (${T}, ${id}, ${ids[i]}, '+919800000003', 'E', ${states[i]!}, ${i < 100 ? 'a' : 'b'}, 'test')`;
      await sql`update campaigns set status = 'running' where id = ${id}`;
      const r = await (await rep()).campaignReportFor(ctx(), id); if (!r.ok) throw new Error(r.error); expect(r.data.abTest!.hold!.suggested).toBe('b');
      const small = await made(); await afterLaunch(small, { testStates: ['read', 'delivered', 'delivered', 'read'] });
      const r2 = await (await rep()).campaignReportFor(ctx(), small); if (!r2.ok) throw new Error(r2.error); expect(r2.data.abTest!.hold!.suggested).toBeNull();
    });
    it('a campaign without the hold option has no hold section', async () => {
      const c = await core(); const r0 = await c.createCampaignFor(ctx(), ab()); const id = r0.ok ? r0.data.id : '';
      const r = await (await rep()).campaignReportFor(ctx(), id); if (!r.ok) throw new Error(r.error); expect(r.data.abTest!.hold).toBeNull();
    });
  });
});

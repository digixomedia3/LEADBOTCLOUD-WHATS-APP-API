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

describe('A/B test campaigns (web rules and report)', () => {
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
  const row = async (id: string) => (await sql`select ab_template_id, ab_var_map, ab_percent_b, status from campaigns where id = ${id}`)[0]!;

  beforeAll(async () => {
    process.env.APP_URL = 'https://panel.example-company.in';
    sql = postgres(ADMIN, { max: 2 });
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${U}, 'u', ${U + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${T}, ${'AB web ' + tag}), (${OTHER}, ${'AB other ' + tag})`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${T}, ${U}, 'owner')`;
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

  it('saves a valid test, and a plain campaign has none', async () => {
    const c = await core(); const r = await c.createCampaignFor(ctx(), ab({ abPercentB: 30 })); expect(r.ok).toBe(true);
    expect(await row(r.ok ? r.data.id : '')).toMatchObject({ ab_template_id: t.b, ab_var_map: ['@name'], ab_percent_b: 30 });
    const p = await c.createCampaignFor(ctx(), base()); expect(p.ok).toBe(true); expect(await row(p.ok ? p.data.id : '')).toMatchObject({ ab_template_id: null, ab_var_map: null, ab_percent_b: null });
    const [l] = await sql`select after from audit_log where tenant_id = ${T} and action = 'campaign.created' and after->'abTest' is not null`; expect(l!.after.abTest).toMatchObject({ templateB: t.b, percentB: 30 });
  });

  it('refuses a second template that is not comparable, saving nothing', async () => {
    const c = await core(); const before = Number((await sql`select count(*) from campaigns where tenant_id = ${T}`)[0]!.count);
    const bad: [string, Record<string, unknown>, RegExp][] = [
      ['same template twice', ab({ abTemplateId: t.a }), /must be different/],
      ['not approved', ab({ abTemplateId: t.pending }), /not approved/],
      ['another workspace\'s template', ab({ abTemplateId: t.theirs }), /not found/],
      ['a template that does not exist', ab({ abTemplateId: randomUUID() }), /not found/],
      ['a different category', ab({ abTemplateId: t.util }), /same kind of message/],
      ['one is an offer with a code', ab({ abTemplateId: t.code, abVarMap: ['@name'] }), /same kind of offer/],
      ['one has a countdown', ab({ abTemplateId: t.count }), /same kind of offer/],
      ['one has a tracked link', ab({ abTemplateId: t.tracked, abVarMap: [] }), /same kind of website button/],
      ['wrong number of blanks for B (too few)', ab({ abTemplateId: t.two, abVarMap: ['@name'] }), /has 2 variables/],
      ['wrong number of blanks for B (too many)', ab({ abTemplateId: t.novars, abVarMap: ['@name'] }), /has no variables/],
      ['empty blank', ab({ abVarMap: [''] }), /Fill in every variable/],
      ['share below 10', ab({ abPercentB: 5 }), /at least 10%/], ['share above 90', ab({ abPercentB: 95 }), /at most 90%/], ['share not whole', ab({ abPercentB: 50.5 }), /./],
      ['no share', base({ abTemplateId: t.b, abVarMap: ['@name'] }), /what share/],
      ['no second template', base({ abVarMap: ['@name'], abPercentB: 50 }), /Choose the second template/],
      ['a repeating test', ab({ repeat: 'weekly' }), /cannot repeat/],
    ];
    for (const [why, input, reason] of bad) { const r = await c.createCampaignFor(ctx(), input as never); expect(r, why).toMatchObject({ ok: false }); expect(r.ok ? '' : r.error, why).toMatch(reason); }
    expect(Number((await sql`select count(*) from campaigns where tenant_id = ${T}`)[0]!.count)).toBe(before);
  });

  it('accepts a second template with different blanks and a different body, as long as the kind matches', async () => {
    const c = await core();
    expect((await c.createCampaignFor(ctx(), ab({ abTemplateId: t.novars, abVarMap: [] }))).ok).toBe(true);
    expect((await c.createCampaignFor(ctx(), ab({ abTemplateId: t.two, abVarMap: ['@name', '@phone'] }))).ok).toBe(true);
  });

  it('needs at least 2 people, one for each version', async () => {
    const c = await core(); const solo = (await sql`insert into contact_groups (tenant_id, name) values (${T}, 'solo') returning id`)[0]!.id;
    const one = (await sql`select contact_id from contact_group_members where group_id = ${grp} limit 1`)[0]!.contact_id;
    await sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${T}, ${solo}, ${one})`;
    expect(await c.createCampaignFor(ctx(), ab({ groupIds: [solo] }))).toMatchObject({ ok: false });
    expect((await c.createCampaignFor(ctx(), base({ groupIds: [solo] }))).ok).toBe(true);   // a plain send to one person is fine
  });

  describe('the report', () => {
    let camp = '';
    const add = async (version: string, state: string, n: number) => { for (let i = 0; i < n; i++) await sql`insert into campaign_recipients (tenant_id, campaign_id, phone_e164, name, state, version) values (${T}, ${camp}, ${'+9198' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'x', ${state}, ${version})`; };
    beforeAll(async () => {
      camp = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, ab_template_id, ab_var_map, ab_percent_b) values (${T}, 'Report', ${t.a}, ${'{' + grp + '}'}::uuid[], 'completed', ${t.b}, '["@name"]'::jsonb, 40) returning id`)[0]!.id;
      // A: 100 delivered people: 60 only delivered, 30 read, 10 replied.  B: 100 delivered people: 47 delivered, 40 read, 13 replied.  Plus people who failed or were skipped.
      await add('a', 'delivered', 60); await add('a', 'read', 30); await add('a', 'replied', 10); await add('a', 'failed', 5); await add('a', 'skipped', 7);
      await add('b', 'delivered', 47); await add('b', 'read', 40); await add('b', 'replied', 13); await add('b', 'failed', 3); await add('b', 'skipped', 9);
    });

    it('counts each version on its own, leaves skipped people out, and shows both template names', async () => {
      const r = await (await rep()).campaignReportFor(ctx(), camp); expect(r.ok).toBe(true); if (!r.ok) return;
      const a = r.data.abTest!; expect(a.percentB).toBe(40);
      expect(a.a.counts.received).toBe(105);   // 100 delivered + 5 failed. The 7 skipped people were never messaged, so they are not here.
      expect(a.a.counts).toEqual({ received: 105, delivered: 100, read: 40, replied: 10 }); expect(a.b.counts).toEqual({ received: 103, delivered: 100, read: 53, replied: 13 });
      expect(a.a.template).toBe('ab_a_' + tag); expect(a.b.template).toBe('ab_b_' + tag);
    });

    it('uses the tested maths for the verdicts, and does not call a winner on gaps that could be luck', async () => {
      const r = await (await rep()).campaignReportFor(ctx(), camp); if (!r.ok) throw new Error('report');
      const x = r.data.abTest!.result;
      expect(x.read).toMatchObject({ rateA: 0.4, rateB: 0.53, verdict: 'no_clear_difference', diffPoints: 13 });
      expect(x.reply).toMatchObject({ rateA: 0.1, rateB: 0.13, verdict: 'no_clear_difference' });   // 10 vs 13 of 100: z is about 0.65
      expect(r.data.abTest!.headline).toMatch(/^No clear difference/);
    });

    it('names the winner when the gap is real, in whichever direction, and says too early when there is too little data', async () => {
      const mkc = async (a: [number, number], b: [number, number]) => {   // [delivered-and-read, delivered-only] per version
        const id = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, ab_template_id, ab_var_map, ab_percent_b) values (${T}, 'Winner', ${t.a}, '{}', 'completed', ${t.b}, '["@name"]'::jsonb, 50) returning id`)[0]!.id;
        const put = async (v: string, st: string, n: number) => { for (let i = 0; i < n; i++) await sql`insert into campaign_recipients (tenant_id, campaign_id, phone_e164, name, state, version) values (${T}, ${id}, ${'+9197' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, 'x', ${st}, ${v})`; };
        await put('a', 'read', a[0]); await put('a', 'delivered', a[1]); await put('b', 'read', b[0]); await put('b', 'delivered', b[1]); return id;
      };
      const get = async (id: string) => { const r = await (await rep()).campaignReportFor(ctx(), id); if (!r.ok) throw new Error('report'); return r.data.abTest!; };
      const bWins = await get(await mkc([40, 160], [100, 100]));            // A reads 20%, B reads 50% of 200 each
      expect(bWins.result.read.verdict).toBe('b_better'); expect(bWins.headline).toContain('Version B'); expect(bWins.headline).toContain('more reads');
      const aWins = await get(await mkc([100, 100], [40, 160]));
      expect(aWins.result.read.verdict).toBe('a_better'); expect(aWins.headline).toContain('Version A');
      const early = await get(await mkc([5, 20], [15, 10]));                // 25 people each: a big-looking gap, but too few to trust
      expect(early.result.read.verdict).toBe('too_early'); expect(early.headline).toMatch(/^Too early/);
    });

    it('a campaign that is not a test has no test section, and the funnel still counts everyone', async () => {
      const plain = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status) values (${T}, 'Plain', ${t.a}, '{}', 'completed') returning id`)[0]!.id;
      const r = await (await rep()).campaignReportFor(ctx(), plain); expect(r.ok && r.data.abTest).toBeNull();
      const all = await (await rep()).campaignReportFor(ctx(), camp); expect(all.ok && all.data.funnel[0]!.count).toBe(224);   // both versions plus skipped, in one funnel
    });

    it('another workspace cannot read this report', async () => {
      const other = { ...ctx(), tenantId: OTHER, workspace: { tenantId: OTHER, name: 'o', role: 'owner' as const, plan: 'pro' } };
      expect(await (await rep()).campaignReportFor(other, camp)).toMatchObject({ ok: false });
    });
  });
});

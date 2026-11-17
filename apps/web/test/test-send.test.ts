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

describe('test send', () => {
  let sql: postgres.Sql; let tpl = '', tplCode = '', tplCountdown = '', tplDraft = '', tplVars = '', tplTracked = '', other = '', otherNum = '';
  let tag = '';
  const T = () => import('../src/lib/core/test-send');
  const A = () => import('../src/app/(app)/campaigns/test-actions');
  // A valid Indian mobile: 9 + five digits taken from the run's tag + four digits for the person. (Starting 9 keeps it valid; the tag keeps runs apart.)
  const phone = (i: number) => `+919${String(parseInt(tag, 16) % 100000).padStart(5, '0')}${String(1000 + i)}`;
  const tests = async () => (await sql`select m.*, c.phone_e164 from messages m join conversations v on v.id = m.conversation_id join contacts c on c.id = v.contact_id where m.tenant_id = ${tenant} and m.is_test order by m.created_at`);
  const mkTpl = async (name: string, status: string, body: string, buttons: object[] = [], offer: object | null = null) => (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons, offer) values (${tenant}, ${name}, 'en', 'marketing', ${status}, ${body}, ${sql.json(buttons as never)}, ${offer ? sql.json(offer as never) : null}) returning id`)[0]!.id as string;

  beforeAll(async () => {
    process.env.APP_URL = 'https://panel.example-company.in'; role = 'owner';
    sql = postgres(ADMIN, { max: 2 }); tag = randomUUID().slice(0, 8);
    tenant = randomUUID(); user = `ts-${tag}`; other = randomUUID();
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name, quiet_hours_enabled) values (${tenant}, ${'TS ' + tag}, true)`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    await sql`insert into tenants (id, name) values (${other}, ${'TS other ' + tag})`;
    const a = await sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${'ts-waba-' + tag}, 'x', 'valid', 'ok') returning id`;
    await sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${tenant}, ${a[0]!.id}, ${'ts-pn-' + tag}, '+91 9')`;
    tpl = await mkTpl('ts_plain', 'approved', 'Hello, this is a plain test.');
    tplVars = await mkTpl('ts_vars', 'approved', 'Hello {{1}}, your code is {{2}}.');
    tplCode = await mkTpl('ts_code', 'approved', 'Your offer.', [{ type: 'copy_code', value: 'x' }]);
    tplCountdown = await mkTpl('ts_count', 'approved', 'Hurry.', [], { text: 'Hurry up!', hasExpiration: true });
    tplDraft = await mkTpl('ts_draft', 'draft', 'Not yet.');
    tplTracked = await mkTpl('ts_tracked', 'approved', 'Look.', [{ type: 'url', value: 'https://panel.example-company.in/r/{{1}}' }]);
    otherNum = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${other}, '+919990000001', 'Other co', 'allowed') returning id`)[0]!.id;
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id in (${tenant}, ${other})`;
    await sql`delete from tenants where id in (${tenant}, ${other})`; await sql`delete from "user" where id = ${user}`;
    await sql.end();
  });

  it('saves a test number as a contact who agreed, normalises it, and refuses bad or repeated input', async () => {
    const t = await T();
    expect(await t.addTestNumber(ctx(), '', 'Me')).toMatchObject({ ok: false });
    expect(await t.addTestNumber(ctx(), '12345', 'Me')).toMatchObject({ ok: false });
    expect(await t.addTestNumber(ctx(), '98765 43210', '')).toMatchObject({ ok: false });
    expect(await t.addTestNumber(ctx(), '98765 43210', 'x'.repeat(41))).toMatchObject({ ok: false });
    const r = await t.addTestNumber(ctx(), '098765 43210', 'My phone'); expect(r).toMatchObject({ ok: true, data: { phone: '+919876543210', label: 'My phone' } });
    expect(await t.addTestNumber(ctx(), '+91 98765 43210', 'Again')).toMatchObject({ ok: false });
    const [c] = await sql`select consent_status, tags, consent_source from contacts where tenant_id = ${tenant} and phone_e164 = '+919876543210'`;
    expect(c).toMatchObject({ consent_status: 'allowed', consent_source: 'test_number' }); expect(c!.tags).toContain('test-number');
    expect((await sql`select action from audit_log where tenant_id = ${tenant} and action = 'test_number.added'`).length).toBe(1);
  });

  it('will not turn an opted-out contact, or one with no permission on record, into a test number', async () => {
    const t = await T();
    await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${tenant}, ${phone(1)}, 'Stopped', 'stopped'), (${tenant}, ${phone(2)}, 'Unknown', 'unknown')`;
    expect(await t.addTestNumber(ctx(), phone(1), 'Stopped')).toMatchObject({ ok: false, error: expect.stringContaining('opted out') });
    expect(await t.addTestNumber(ctx(), phone(2), 'Unknown')).toMatchObject({ ok: false, error: expect.stringContaining('no permission recorded') });
    expect((await sql`select consent_status from contacts where tenant_id = ${tenant} and phone_e164 = ${phone(1)}`)[0]!.consent_status).toBe('stopped');   // their opt-out is untouched
    expect((await sql`select consent_status from contacts where tenant_id = ${tenant} and phone_e164 = ${phone(2)}`)[0]!.consent_status).toBe('unknown');
  });

  it('keeps at most 5 numbers, even when requests arrive at the same moment', async () => {
    const t = await T();
    const rs = await Promise.all([10, 11, 12, 13, 14, 15, 16, 17].map((i) => t.addTestNumber(ctx(), phone(i), 'N' + i)));
    expect(rs.filter((r) => r.ok).length).toBe(4);   // one was already saved above
    expect((await sql`select count(*)::int n from test_numbers where tenant_id = ${tenant}`)[0]!.n).toBe(5);
    expect((await t.addTestNumber(ctx(), phone(20), 'Sixth'))).toMatchObject({ ok: false });
    await expect(sql`insert into test_numbers (tenant_id, contact_id, phone_e164, label) select ${tenant}, id, '+919000000099', 'bypass' from contacts where tenant_id = ${tenant} limit 1`).rejects.toThrow();   // the database refuses a sixth too
  });

  it('sends a real queued message only to saved numbers, filling the blanks, and never holds it for quiet hours', async () => {
    const t = await T(); const nums = await t.listTestNumbers(ctx());
    const r = await t.sendTestFor(ctx(), { templateId: tplVars, numberIds: [nums[0]!.id], varMap: ['@name', 'FIX42'] });
    expect(r).toMatchObject({ ok: true, data: { sent: 1 } });
    const m = (await tests()).at(-1)!;
    expect(m).toMatchObject({ status: 'queued', direction: 'out', template_name: 'ts_vars', is_test: true, campaign_recipient_id: null }); expect(m.payload.params).toEqual(['My', 'FIX42']);
    expect(m.not_before).toBeNull();
    expect(m.phone_e164).toBe(nums[0]!.phone);
  });

  it('refuses a number that is not saved, one from another workspace, a missing one, and an empty list', async () => {
    const t = await T(); const before = (await tests()).length;
    await sql`insert into test_numbers (tenant_id, contact_id, phone_e164, label) values (${other}, ${otherNum}, '+919990000001', 'theirs')`;
    const theirs = (await sql`select id from test_numbers where tenant_id = ${other}`)[0]!.id;
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: [theirs] })).toMatchObject({ ok: false });
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: [randomUUID()] })).toMatchObject({ ok: false });
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: [] })).toMatchObject({ ok: false });
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: ['not-an-id'] })).toMatchObject({ ok: false });
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: [(await t.listTestNumbers(ctx()))[0]!.id, randomUUID()] })).toMatchObject({ ok: false });   // one bad id sends nothing at all
    expect((await tests()).length).toBe(before);
    expect(await t.removeTestNumber(ctx(), theirs)).toMatchObject({ ok: false });   // cannot remove another workspace's
    expect((await sql`select count(*)::int n from test_numbers where tenant_id = ${other}`)[0]!.n).toBe(1);
  });

  it('checks the template: approved, blanks filled, offer details, no tracked link', async () => {
    const t = await T(); const id = (await t.listTestNumbers(ctx()))[0]!.id; const send = (templateId: string, extra: Record<string, unknown> = {}) => t.sendTestFor(ctx(), { templateId, numberIds: [id], ...extra });
    expect(await send(tplDraft)).toMatchObject({ ok: false });
    expect(await send(randomUUID())).toMatchObject({ ok: false });
    expect(await send(tplVars, { varMap: ['@name'] })).toMatchObject({ ok: false });             // 2 blanks, 1 given
    expect(await send(tpl, { varMap: ['x'] })).toMatchObject({ ok: false });                       // 0 blanks, 1 given
    expect(await send(tplCode)).toMatchObject({ ok: false });                                       // needs a code
    expect(await send(tplCode, { offerCode: 'bad code!' })).toMatchObject({ ok: false });
    expect(await send(tplCountdown)).toMatchObject({ ok: false });                                  // needs an end time
    expect(await send(tplCountdown, { offerEndsAt: new Date(Date.now() + 5 * 60_000).toISOString() })).toMatchObject({ ok: false });   // too soon to see the countdown
    expect(await send(tplTracked)).toMatchObject({ ok: false });
    const before = (await tests()).length;
    expect(await send(tplCode, { offerCode: 'TEST10' })).toMatchObject({ ok: true });
    expect(await send(tplCountdown, { offerEndsAt: new Date(Date.now() + 3 * 3_600_000).toISOString() })).toMatchObject({ ok: true });
    const ms = (await tests()).slice(before); expect(ms[0]!.payload.code).toBe('TEST10'); expect(typeof ms[1]!.payload.offerExpiresMs).toBe('number');
  });

  it('limits tests to 20 an hour per workspace, counting recent ones only, and holds under simultaneous requests', async () => {
    const t = await T(); const ids = (await t.listTestNumbers(ctx())).map((n) => n.id);
    await sql`delete from messages where tenant_id = ${tenant} and is_test`;
    const send = () => t.sendTestFor(ctx(), { templateId: tpl, numberIds: ids });          // 5 messages each
    const rs = await Promise.all([send(), send(), send(), send(), send(), send()]);       // 30 wanted, 20 allowed: exactly 4 can succeed
    expect(rs.filter((r) => r.ok).length).toBe(4);
    expect((await tests()).length).toBe(20);
    const refused = rs.find((r) => !r.ok); expect(refused && !refused.ok && refused.error).toContain('20 test messages an hour');
    await sql`update messages set created_at = now() - interval '2 hours' where tenant_id = ${tenant} and is_test`;
    expect(await send()).toMatchObject({ ok: true, data: { remainingThisHour: 15 } });  // old tests no longer count
  });

  it('respects an opt-out that happened after the number was saved', async () => {
    const t = await T(); const nums = await t.listTestNumbers(ctx()); const victim = nums[1]!;
    await sql`delete from messages where tenant_id = ${tenant} and is_test`;
    await sql`update contacts set consent_status = 'stopped' where tenant_id = ${tenant} and phone_e164 = ${victim.phone}`;
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: [nums[0]!.id, victim.id] })).toMatchObject({ ok: true, data: { sent: 1 } });
    expect((await tests()).map((m) => m.phone_e164)).toEqual([nums[0]!.phone]);
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: [victim.id] })).toMatchObject({ ok: false });
  });

  it('needs a working connection, and not a suspended workspace', async () => {
    const t = await T(); const id = (await t.listTestNumbers(ctx()))[0]!.id; await sql`delete from messages where tenant_id = ${tenant} and is_test`;
    await sql`update meta_accounts set token_status = 'invalid' where tenant_id = ${tenant}`;
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: [id] })).toMatchObject({ ok: false });
    await sql`update meta_accounts set token_status = 'valid' where tenant_id = ${tenant}`; await sql`update tenants set status = 'suspended' where id = ${tenant}`;
    expect(await t.sendTestFor(ctx(), { templateId: tpl, numberIds: [id] })).toMatchObject({ ok: false });
    await sql`update tenants set status = 'ready' where id = ${tenant}`;
    expect((await tests()).length).toBe(0);
  });

  it('only owners and admins can use it, and removing a number is logged', async () => {
    const a = await A(); const t = await T();
    for (const r of ['agent', 'viewer'] as const) {
      role = r;
      expect(await a.sendTest({ templateId: tpl, numberIds: [randomUUID()] })).toMatchObject({ ok: false });
      expect(await a.saveTestNumber('98765 00000', 'x')).toMatchObject({ ok: false });
      expect(await a.loadTestNumbers()).toMatchObject({ ok: false });
    }
    role = 'admin'; const nums = await t.listTestNumbers(ctx());
    expect(await a.deleteTestNumber(nums[4]!.id)).toMatchObject({ ok: true }); role = 'owner';
    expect((await sql`select 1 from audit_log where tenant_id = ${tenant} and action = 'test_number.removed'`).length).toBe(1);
    expect((await t.listTestNumbers(ctx())).length).toBe(4);
  });
});

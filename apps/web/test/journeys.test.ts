import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));
let role: 'owner' | 'admin' | 'agent' | 'viewer' = 'owner';
let tenant = '', user = '';
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, requireCtx: async () => ({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role, plan: 'pro' }, role, workspaces: [] }) };
});
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
const APP = 'https://panel.example-company.in';

describe('journeys (web actions)', () => {
  let sql: postgres.Sql; let tpl = '', tplCode = '', tplDraft = '', grp = '', other = '';
  const people: string[] = [];
  const steps = (id = tpl) => [{ type: 'send_template' as const, templateId: id, varMap: ['@name'] }, { type: 'wait' as const, minutes: 1440 }, { type: 'send_template' as const, templateId: id, varMap: ['@name'] }];
  const save = async (o: Record<string, unknown> = {}) => (await import('../src/app/(app)/journeys/actions')).saveJourney({ name: 'Welcome ' + Math.random().toString(36).slice(2, 7), trigger: { type: 'manual' }, steps: steps(), stopOnReply: true, ...o } as never);
  beforeAll(async () => {
    process.env.APP_URL = APP; role = 'owner';
    sql = postgres(ADMIN, { max: 2 });
    tenant = randomUUID(); user = `jw-${randomUUID().slice(0, 8)}`; other = randomUUID();
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${'JW ' + user})`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    await sql`insert into tenants (id, name) values (${other}, ${'JW other ' + user})`;
    const a = await sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${'jw-waba-' + user}, 'x', 'valid', 'ok') returning id`;
    await sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${tenant}, ${a[0]!.id}, ${'jw-pn-' + user}, '+91 9')`;
    tpl = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'jw_ok', 'en', 'marketing', 'approved', 'Hello {{1}}, thanks for asking.', '[]') returning id`)[0]!.id;
    tplCode = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'jw_code', 'en', 'marketing', 'approved', 'Hello {{1}}, your offer.', ${sql.json([{ type: 'copy_code', text: 'Copy' }])}) returning id`)[0]!.id;
    tplDraft = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'jw_draft', 'en', 'marketing', 'draft', 'Hello {{1}}, soon.', '[]') returning id`)[0]!.id;
    grp = (await sql`insert into contact_groups (tenant_id, name) values (${tenant}, 'g') returning id`)[0]!.id;
    for (const [i, st] of ['allowed', 'allowed', 'allowed', 'stopped'].entries()) {
      const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${tenant}, ${'+91990009' + String(1000 + i)}, ${'P' + i}, ${st}) returning id`)[0]!.id; people.push(c);
      await sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${tenant}, ${grp}, ${c})`;
    }
  });
  afterAll(async () => { await sql`delete from audit_log where tenant_id in (${tenant}, ${other})`; await sql`delete from tenants where id in (${tenant}, ${other})`; await sql`delete from "user" where id = ${user}`; await sql.end(); });

  it('saves a good journey as a draft and logs it', async () => {
    const r = await save({ name: 'First one' }); expect(r.ok).toBe(true);
    if (r.ok) { const j = (await sql`select status, stop_on_reply from journeys where id = ${r.data.id}`)[0]!; expect(j).toMatchObject({ status: 'draft', stop_on_reply: true }); }
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'journey.created'`)[0]!.n)).toBeGreaterThan(0);
  });
  it('only an owner or admin may change anything', async () => {
    const m = await import('../src/app/(app)/journeys/actions'); const mk = (await save({ name: 'For perms' })); if (!mk.ok) throw new Error(mk.error); const id = mk.data.id;
    for (const r of ['agent', 'viewer'] as const) {
      role = r;
      for (const x of [await save(), await m.setJourneyStatus(id, 'active'), await m.deleteJourney(id), await m.enrollGroup(id, grp), await m.stopAllRuns(id)]) expect(x.ok, r).toBe(false);
    }
    role = 'admin'; expect((await save({ name: 'By admin' })).ok).toBe(true); role = 'owner';
    expect((await sql`select 1 from journeys where id = ${id}`).length).toBe(1);
  });
  it('anyone on the team can read the list', async () => { role = 'viewer'; const { listJourneys } = await import('../src/app/(app)/journeys/actions'); expect((await listJourneys()).length).toBeGreaterThan(0); role = 'owner'; });
  it('refuses nonsense with a plain reason', async () => {
    for (const bad of [{ name: '' }, { steps: [] }, { steps: [{ type: 'wait', minutes: 5 }] }, { steps: [{ type: 'send_template', templateId: tpl, varMap: ['@name'] }, { type: 'send_template', templateId: tpl, varMap: ['@name'] }] }, { steps: [{ type: 'send_template', templateId: tpl, varMap: ['@name'] }, { type: 'wait', minutes: 5 }] }, { steps: [{ type: 'send_template', templateId: tpl, varMap: [] }] }, { steps: [{ type: 'send_template', templateId: randomUUID(), varMap: ['@name'] }] }]) {
      const r = await save(bad); expect(r.ok, JSON.stringify(bad)).toBe(false); expect(!r.ok && r.error.length > 8).toBe(true);
    }
  });
  it('refuses templates a journey cannot use, and says why', async () => {
    const a = await save({ steps: [{ type: 'send_template', templateId: tplCode, varMap: ['@name'] }] }); expect(!a.ok && a.error).toMatch(/Copy code/);
    const b = await save({ steps: [{ type: 'send_template', templateId: tplDraft, varMap: ['@name'] }] }); expect(!b.ok && b.error).toMatch(/approved/);
  });
  it('refuses a template from another workspace', async () => {
    const t2 = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${other}, 'theirs', 'en', 'marketing', 'approved', 'Hello {{1}}', '[]') returning id`)[0]!.id;
    const r = await save({ steps: [{ type: 'send_template', templateId: t2, varMap: ['@name'] }] }); expect(!r.ok && r.error).toMatch(/not found/);
  });
  it('two journeys cannot share a name (even in different capitals)', async () => {
    await save({ name: 'Same Name' }); const r = await save({ name: 'same name' }); expect(!r.ok && r.error).toMatch(/already have/);
  });
  it('the template picker explains instead of hiding', async () => {
    const { listTemplateChoices } = await import('../src/app/(app)/journeys/actions'); const c = await listTemplateChoices();
    expect(c.find((x) => x.id === tpl)).toMatchObject({ usable: true, why: null }); expect(c.find((x) => x.id === tplCode)).toMatchObject({ usable: false }); expect(c.find((x) => x.id === tplCode)!.why).toMatch(/Copy code/);
    expect(c.find((x) => x.id === tplDraft)!.why).toMatch(/approved/); expect(c.some((x) => x.name === 'theirs')).toBe(false);
  });

  it('starts only when a number is connected and everything still checks out; pausing works; the list shows it', async () => {
    const m = await import('../src/app/(app)/journeys/actions'); const mk = await save({ name: 'To start' }); if (!mk.ok) throw new Error(mk.error);
    expect((await m.setJourneyStatus(mk.data.id, 'active')).ok).toBe(true);
    expect((await m.listJourneys()).find((j) => j.id === mk.data.id)!.status).toBe('active');
    expect((await m.setJourneyStatus(mk.data.id, 'paused')).ok).toBe(true);
    await sql`update templates set status = 'rejected' where id = ${tpl}`;
    try { const r = await m.setJourneyStatus(mk.data.id, 'active'); expect(!r.ok && r.error).toMatch(/approved/); } finally { await sql`update templates set status = 'approved' where id = ${tpl}`; }
    await sql`update meta_accounts set token_status = 'revoked' where tenant_id = ${tenant}`;
    try { const r = await m.setJourneyStatus(mk.data.id, 'active'); expect(!r.ok && r.error).toMatch(/WhatsApp/); } finally { await sql`update meta_accounts set token_status = 'valid' where tenant_id = ${tenant}`; }
  });
  it('refuses odd status values and bad ids', async () => { const m = await import('../src/app/(app)/journeys/actions'); expect((await m.setJourneyStatus('nope', 'active')).ok).toBe(false); expect((await m.setJourneyStatus(randomUUID(), 'active')).ok).toBe(false); expect((await m.setJourneyStatus(randomUUID(), 'draft' as never)).ok).toBe(false); });
  it('a running journey must be paused before it is edited or deleted', async () => {
    const m = await import('../src/app/(app)/journeys/actions'); const mk = await save({ name: 'Running one' }); if (!mk.ok) throw new Error(mk.error); await m.setJourneyStatus(mk.data.id, 'active');
    const e = await save({ id: mk.data.id, name: 'Running one' }); expect(!e.ok && e.error).toMatch(/Pause/); const d = await m.deleteJourney(mk.data.id); expect(!d.ok && d.error).toMatch(/Pause/);
    await m.setJourneyStatus(mk.data.id, 'paused'); expect((await save({ id: mk.data.id, name: 'Running one renamed' })).ok).toBe(true); expect((await m.deleteJourney(mk.data.id)).ok).toBe(true);
  });

  it('adding a group puts in the allowed people once, skips and counts the one who opted out, and starts nothing for a journey that is not running', async () => {
    const m = await import('../src/app/(app)/journeys/actions'); const mk = await save({ name: 'Enrol me' }); if (!mk.ok) throw new Error(mk.error);
    const early = await m.enrollGroup(mk.data.id, grp); expect(!early.ok && early.error).toMatch(/Start the journey/);
    await m.setJourneyStatus(mk.data.id, 'active');
    const a = await m.enrollGroup(mk.data.id, grp); expect(a.ok && a.data).toMatchObject({ enrolled: 3, alreadyIn: 0, optedOut: 1 });
    const b = await m.enrollGroup(mk.data.id, grp); expect(b.ok && b.data).toMatchObject({ enrolled: 0, alreadyIn: 3 });
    expect(Number((await sql`select count(*)::int n from journey_runs where journey_id = ${mk.data.id}`)[0]!.n)).toBe(3);
    expect((await sql`select 1 from journey_runs where journey_id = ${mk.data.id} and contact_id = ${people[3]!}`).length).toBe(0);
  });
  it('refuses a group that is not yours or does not exist', async () => {
    const m = await import('../src/app/(app)/journeys/actions'); const mk = await save({ name: 'Group check' }); if (!mk.ok) throw new Error(mk.error); await m.setJourneyStatus(mk.data.id, 'active');
    const theirs = (await sql`insert into contact_groups (tenant_id, name) values (${other}, 'theirs') returning id`)[0]!.id;
    expect((await m.enrollGroup(mk.data.id, theirs)).ok).toBe(false); expect((await m.enrollGroup(mk.data.id, randomUUID())).ok).toBe(false); expect((await m.enrollGroup(mk.data.id, 'x')).ok).toBe(false);
  });
  it('the people list shows progress and plain reasons, and the stop-all button works', async () => {
    const m = await import('../src/app/(app)/journeys/actions'); const mk = await save({ name: 'Progress' }); if (!mk.ok) throw new Error(mk.error); await m.setJourneyStatus(mk.data.id, 'active'); await m.enrollGroup(mk.data.id, grp);
    const runs = await m.listRuns(mk.data.id); expect(runs).toHaveLength(3); expect(runs.every((r) => r.status === 'active')).toBe(true);
    const s = await m.stopAllRuns(mk.data.id); expect(s.ok && s.data.stopped).toBe(3);
    const after = await m.listRuns(mk.data.id); expect(after.every((r) => r.status === 'stopped' && /Stopped by you/.test(r.reason ?? ''))).toBe(true);
    expect((await m.listRuns('nope'))).toEqual([]); expect((await m.stopAllRuns(randomUUID())).ok && true).toBe(true);
  });
  it('saves checks, tag triggers and hand-over steps, and reads them back unchanged', async () => {
    const [{ id: agent }] = await sql`select id from "user" where id = ${user}`;   // the signed-in owner is a member, so they can be assigned
    const steps = [{ type: 'send_template', templateId: tpl, varMap: ['@name'] }, { type: 'wait', minutes: 1440 }, { type: 'only_if', check: 'not_read_last' }, { type: 'assign', userId: agent }, { type: 'only_if', check: 'has_tag', tag: 'vip' }, { type: 'add_tag', tag: 'done' }];
    const r = await save({ name: 'Rich one', trigger: { type: 'tag_added', tag: 'interested' }, steps }); expect(r.ok, JSON.stringify(r)).toBe(true);
    const j = (await sql`select trigger, steps from journeys where id = ${r.ok ? r.data.id : ''}`)[0]!; expect(j.trigger).toEqual({ type: 'tag_added', tag: 'interested' }); expect(j.steps).toEqual(steps);
    const m = await import('../src/app/(app)/journeys/actions'); const row = (await m.listJourneys()).find((x) => x.name === 'Rich one')!; expect(row.steps).toEqual(steps); expect(row.trigger).toEqual({ type: 'tag_added', tag: 'interested' });
  });
  it('refuses a hand-over to someone outside the workspace, to a viewer, or to nobody, and a check with a missing tag or no wait', async () => {
    const m = await import('../src/app/(app)/journeys/actions');
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${'vw-' + user}, 'Viewer', ${'vw-' + user + '@example.com'}, true, now(), now()), (${'ot-' + user}, 'Outsider', ${'ot-' + user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${'vw-' + user}, 'viewer')`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${other}, ${'ot-' + user}, 'owner')`;
    const base = (extra: object[]) => [{ type: 'send_template', templateId: tpl, varMap: ['@name'] }, { type: 'wait', minutes: 60 }, ...extra, { type: 'add_tag', tag: 'z' }];
    const cases: [string, object[], RegExp][] = [
      ['a viewer', [{ type: 'assign', userId: 'vw-' + user }], /viewers cannot work chats/],
      ['someone from another workspace', [{ type: 'assign', userId: 'ot-' + user }], /not in this workspace/],
      ['a person who does not exist', [{ type: 'assign', userId: 'nobody-at-all' }], /not in this workspace/],
      ['no teammate chosen', [{ type: 'assign', userId: '' }], /Choose a teammate/],
      ['a tag check without a tag', [{ type: 'only_if', check: 'has_tag' }], /enter the tag/],
    ];
    for (const [why, extra, reason] of cases) { const r = await m.saveJourney({ name: 'Bad ' + why, trigger: { type: 'manual' }, steps: base(extra) as never }); expect(r.ok, why).toBe(false); expect(r.ok ? '' : r.error, why).toMatch(reason); }
    const noWait = await m.saveJourney({ name: 'Bad no wait', trigger: { type: 'manual' }, steps: [{ type: 'send_template', templateId: tpl, varMap: ['@name'] }, { type: 'only_if', check: 'read_last' }, { type: 'add_tag', tag: 'z' }] as never }); expect(noWait.ok).toBe(false); expect(!noWait.ok && noWait.error).toMatch(/put a wait/);
    const tagless = await m.saveJourney({ name: 'Bad tag trigger', trigger: { type: 'tag_added', tag: '' } as never, steps: base([]) as never }); expect(tagless.ok).toBe(false);
    expect((await sql`select 1 from journeys where tenant_id = ${tenant} and name like 'Bad %'`).length).toBe(0);
    await sql`delete from tenant_members where user_id in (${'vw-' + user}, ${'ot-' + user})`; await sql`delete from "user" where id in (${'vw-' + user}, ${'ot-' + user})`;
  });
  it('a teammate who left after the journey was built stops it from starting, rather than failing later', async () => {
    const m = await import('../src/app/(app)/journeys/actions'); await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${'lv-' + user}, 'Leaver', ${'lv-' + user + '@example.com'}, true, now(), now())`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${'lv-' + user}, 'agent')`;
    const r = await m.saveJourney({ name: 'Leaver journey', trigger: { type: 'manual' }, steps: [{ type: 'assign', userId: 'lv-' + user }, { type: 'send_template', templateId: tpl, varMap: ['@name'] }] as never }); expect(r.ok).toBe(true); if (!r.ok) return;
    await sql`delete from tenant_members where user_id = ${'lv-' + user}`;
    const a = await sql`select id from meta_accounts where tenant_id = ${tenant} limit 1`; void a;
    const start = await m.setJourneyStatus(r.data.id, 'active'); expect(start.ok).toBe(false); expect(!start.ok && start.error).toMatch(/not in this workspace/);
    await sql`delete from "user" where id = ${'lv-' + user}`;
  });
  it('lists teammates for the hand-over step, without viewers, and only this workspace\'s', async () => {
    const m = await import('../src/app/(app)/journeys/actions'); await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${'tv-' + user}, 'Tv', ${'tv-' + user + '@example.com'}, true, now(), now()), (${'ta-' + user}, 'Ta', ${'ta-' + user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${'tv-' + user}, 'viewer'), (${other}, ${'ta-' + user}, 'agent')`;
    const ids = (await m.listAssignees()).map((x) => x.userId); expect(ids).toContain(user); expect(ids).not.toContain('tv-' + user); expect(ids).not.toContain('ta-' + user);
    await sql`delete from tenant_members where user_id in (${'tv-' + user}, ${'ta-' + user})`; await sql`delete from "user" where id in (${'tv-' + user}, ${'ta-' + user})`;
  });
  it('one workspace never sees another\'s journeys', async () => {
    await sql`insert into journeys (tenant_id, name, status, steps) values (${other}, 'Theirs only', 'active', '[]'::jsonb)`;
    const { listJourneys } = await import('../src/app/(app)/journeys/actions'); expect((await listJourneys()).some((j) => j.name === 'Theirs only')).toBe(false);
  });

  describe('copying a journey', () => {
    const mod = () => import('../src/app/(app)/journeys/actions');
    it('copies steps and trigger into a draft with nobody in it, even from a running journey', async () => {
      const m = await mod(); const a = await save({ name: 'Original run' }); expect(a.ok).toBe(true); const id = (a as { data: { id: string } }).data.id;
      await sql`update journeys set status = 'active' where id = ${id}`;
      await sql`insert into journey_runs (tenant_id, journey_id, contact_id, status, step_index, next_run_at) select ${tenant}, ${id}, id, 'active', 0, now() from contacts where tenant_id = ${tenant} limit 1`;
      const c = await m.duplicateJourney(id); expect(c.ok).toBe(true); if (!c.ok) return;
      expect(c.data.name).toBe('Original run (copy)');
      const [o] = await sql`select status, steps, trigger, stop_on_reply from journeys where id = ${id}`; const [k] = await sql`select status, steps, trigger, stop_on_reply from journeys where id = ${c.data.id}`;
      expect(k!.status).toBe('draft'); expect(o!.status).toBe('active');
      expect(k!.steps).toEqual(o!.steps); expect(k!.trigger).toEqual(o!.trigger); expect(k!.stop_on_reply).toBe(o!.stop_on_reply);
      expect((await sql`select count(*)::int n from journey_runs where journey_id = ${c.data.id}`)[0]!.n).toBe(0);
      expect((await sql`select count(*)::int n from journey_runs where journey_id = ${id}`)[0]!.n).toBe(1);
      expect((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'journey.duplicated' and entity_id = ${c.data.id}`)[0]!.n).toBe(1);
    });
    it('numbers repeat copies and never copies a copy into "(copy) (copy)"', async () => {
      const m = await mod(); const a = await save({ name: 'Seq base' }); const id = (a as { data: { id: string } }).data.id;
      const c1 = await m.duplicateJourney(id), c2 = await m.duplicateJourney(id);
      expect(c1.ok && c1.data.name).toBe('Seq base (copy)'); expect(c2.ok && c2.data.name).toBe('Seq base (copy 2)');
      const c3 = await m.duplicateJourney((c1 as { data: { id: string } }).data.id); expect(c3.ok && c3.data.name).toBe('Seq base (copy 3)');
    });
    it('treats names case-insensitively and stays inside the 80-letter name limit', async () => {
      const m = await mod(); await sql`insert into journeys (tenant_id, name, status, steps) values (${tenant}, 'case base (COPY)', 'draft', '[]'::jsonb)`;
      const a = await save({ name: 'Case base' }); const c = await m.duplicateJourney((a as { data: { id: string } }).data.id); expect(c.ok && c.data.name).toBe('Case base (copy 2)');
      const long = 'L'.repeat(80); await sql`insert into journeys (tenant_id, name, status, steps) values (${tenant}, ${long}, 'draft', '[]'::jsonb)`;
      const [lj] = await sql`select id from journeys where tenant_id = ${tenant} and name = ${long}`; const lc = await m.duplicateJourney(lj!.id);
      expect(lc.ok).toBe(true); if (lc.ok) expect(lc.data.name.length).toBeLessThanOrEqual(80);
    });
    it('refuses bad ids, missing journeys, another workspace\'s journey, and anyone below admin', async () => {
      const m = await mod(); expect((await m.duplicateJourney('nope')).ok).toBe(false); expect((await m.duplicateJourney(randomUUID())).ok).toBe(false);
      const [t] = await sql`insert into journeys (tenant_id, name, status, steps) values (${other}, 'Not yours', 'draft', '[]'::jsonb) returning id`;
      const r = await m.duplicateJourney(t!.id); expect(r.ok).toBe(false);
      expect((await sql`select count(*)::int n from journeys where name like 'Not yours%' and tenant_id = ${tenant}`)[0]!.n).toBe(0);
      const a = await save({ name: 'Role base' }); const id = (a as { data: { id: string } }).data.id; const before = (await sql`select count(*)::int n from journeys where tenant_id = ${tenant}`)[0]!.n;
      for (const r2 of ['agent', 'viewer'] as const) { role = r2; const x = await m.duplicateJourney(id); expect(x.ok).toBe(false); }
      role = 'owner'; expect((await sql`select count(*)::int n from journeys where tenant_id = ${tenant}`)[0]!.n).toBe(before);
    });
  });
});

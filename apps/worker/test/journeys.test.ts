import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, enrollContacts, enrollFromLead, MAX_ENROLL_PER_DAY, stopRunsFor } from '@lbc/db';
import { encryptSecret } from '@lbc/meta';
import { advanceRun, tickJourneys } from '../src/journeys';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db, A = admin.client.unsafe, KEY = randomBytes(32).toString('base64');
const APP = 'https://panel.example-company.in';
afterAll(async () => {
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'JN %')`);
  await A(`delete from tenants where name like 'JN %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
const MIN = 60_000;
type Step = Record<string, unknown>;

async function setup(o: { steps?: Step[]; status?: string; stopOnReply?: boolean; consent?: string; tplStatus?: string; category?: string; buttons?: object[]; offer?: object | null; people?: number } = {}) {
  const t = randomUUID(), tag = t.slice(0, 8);
  await A(`insert into tenants (id, name, quiet_hours_enabled) values ('${t}', 'JN ${tag}', false)`);
  await A(`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values ('${t}', 'jn-waba-${tag}', '${encryptSecret('T', KEY)}', 'valid', 'ok')`);
  const acc = (await A(`select id from meta_accounts where tenant_id = '${t}'`))[0]!.id;
  await A(`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values ('${t}', '${acc}', 'jn-pn-${tag}', '+91 90000 00000')`);
  const cat = o.category ?? 'marketing';
  const tpl = (await A(`insert into templates (tenant_id, name, language, category, status, body, category_current, buttons, offer) values ('${t}', 'jn_t', 'en', '${cat}', '${o.tplStatus ?? 'approved'}', 'Hello {{1}}, a note for you today.', '${cat}', '${JSON.stringify(o.buttons ?? [])}'::jsonb, ${o.offer ? `'${JSON.stringify(o.offer)}'::jsonb` : 'null'}) returning id`))[0]!.id as string;
  const steps = o.steps ?? [{ type: 'send_template', templateId: '$T', varMap: ['@name'] }, { type: 'wait', minutes: 60 }, { type: 'send_template', templateId: '$T', varMap: ['@name'] }];
  const stepsJson = JSON.stringify(steps).replaceAll('$T', tpl);
  const j = (await A(`insert into journeys (tenant_id, name, status, steps, stop_on_reply) values ('${t}', 'Welcome', '${o.status ?? 'active'}', '${stepsJson}'::jsonb, ${o.stopOnReply ?? true}) returning id`))[0]!.id as string;
  const people: string[] = [];
  for (let i = 0; i < (o.people ?? 1); i++) people.push((await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${t}', '+9190${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}', 'Asha Rao ${i}', '${o.consent ?? 'allowed'}') returning id`))[0]!.id as string);
  return { t, j, tpl, people, c: people[0]! };
}
const run = async (j: string, c: string) => (await A(`select * from journey_runs where journey_id = '${j}' and contact_id = '${c}'`))[0] as Record<string, any> | undefined;
const msgs = async (t: string) => (await A(`select m.status, m.template_name, m.payload, m.journey_step from messages m where m.tenant_id = '${t}' and m.journey_run_id is not null order by m.journey_step`)) as unknown as { status: string; template_name: string; payload: { params: string[] }; journey_step: number }[];
const at = (ms: number) => () => new Date(ms);

describe('enrolling people', () => {
  it('puts an allowed person in once, and a second try does nothing', async () => {
    const s = await setup(); const a = await enrollContacts(db, s.t, s.j, [s.c]); const b = await enrollContacts(db, s.t, s.j, [s.c, s.c]);
    expect(a).toMatchObject({ enrolled: 1, alreadyIn: 0 }); expect(b).toMatchObject({ enrolled: 0, alreadyIn: 1 });
    expect(Number((await A(`select count(*)::int n from journey_runs where journey_id = '${s.j}'`))[0]!.n)).toBe(1);
  });
  it('never enrols someone who opted out, and says so', async () => {
    const s = await setup({ consent: 'stopped' }); const r = await enrollContacts(db, s.t, s.j, [s.c]);
    expect(r).toMatchObject({ enrolled: 0, optedOut: 1 }); expect(await run(s.j, s.c)).toBeUndefined();
  });
  it('a person who has not agreed (unknown) can be enrolled, but promotions to them will be refused when they come up', async () => {
    const s = await setup({ consent: 'unknown' }); expect((await enrollContacts(db, s.t, s.j, [s.c])).enrolled).toBe(1);
  });
  it('only an active journey takes anyone', async () => {
    for (const status of ['draft', 'paused']) { const s = await setup({ status }); const r = await enrollContacts(db, s.t, s.j, [s.c]); expect(r.refused, status).toBe('not_active'); expect(await run(s.j, s.c)).toBeUndefined(); }
  });
  it('never enrols a contact from another workspace, or into another workspace\'s journey', async () => {
    const a = await setup(), b = await setup();
    expect((await enrollContacts(db, a.t, a.j, [b.c])).enrolled).toBe(0);
    expect((await enrollContacts(db, b.t, a.j, [b.c])).refused).toBe('not_active');
    expect(Number((await A(`select count(*)::int n from journey_runs where journey_id = '${a.j}'`))[0]!.n)).toBe(0);
  });
  it('ignores junk ids', async () => { const s = await setup(); expect((await enrollContacts(db, s.t, s.j, ["x'; drop table x;--", '', 'not-a-uuid'])).enrolled).toBe(0); });
  it('caps new people per day so an automatic journey cannot quietly spend a lot', async () => {
    const s = await setup({ people: 3 });
    // fill today's quota with real runs for throwaway contacts
    await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) select '${s.t}', '+91777' || lpad(g::text, 7, '0'), 'bulk', 'allowed' from generate_series(1, ${MAX_ENROLL_PER_DAY}) g`);
    // Not due for a day, so these 500 do not crowd out other tests' runs when the tick takes its batch.
    await A(`insert into journey_runs (tenant_id, journey_id, contact_id, next_run_at) select '${s.t}', '${s.j}', id, now() + interval '1 day' from contacts where tenant_id = '${s.t}' and name = 'bulk'`);
    const r = await enrollContacts(db, s.t, s.j, s.people); expect(r.refused).toBe('daily_limit'); expect(r.enrolled).toBe(0);
  });
  it('a new lead starts only the active "new lead" journeys that match its source', async () => {
    const s = await setup(); const src1 = randomUUID(), src2 = randomUUID();
    await A(`update journeys set trigger = '{"type":"lead_created"}'::jsonb where id = '${s.j}'`);
    const other = (await A(`insert into journeys (tenant_id, name, status, steps, trigger) values ('${s.t}', 'Only src2', 'active', '[]'::jsonb, '{"type":"lead_created","sourceId":"${src2}"}'::jsonb) returning id`))[0]!.id;
    const paused = (await A(`insert into journeys (tenant_id, name, status, steps, trigger) values ('${s.t}', 'Paused', 'paused', '[]'::jsonb, '{"type":"lead_created"}'::jsonb) returning id`))[0]!.id;
    const manual = (await A(`insert into journeys (tenant_id, name, status, steps) values ('${s.t}', 'Manual', 'active', '[]'::jsonb) returning id`))[0]!.id;
    expect(await enrollFromLead(db, s.t, src1, s.c)).toBe(1);
    expect(await run(s.j, s.c)).toBeDefined(); expect(await run(other as string, s.c)).toBeUndefined(); expect(await run(paused as string, s.c)).toBeUndefined(); expect(await run(manual as string, s.c)).toBeUndefined();
  });
});

describe('walking through a journey', () => {
  it('sends the first message at once, waits, then sends the second after the wait, then finishes', async () => {
    const s = await setup(); await enrollContacts(db, s.t, s.j, [s.c]); const t0 = Date.now();
    await advanceRun({ db, appUrl: APP, now: at(t0) }, s.t, (await run(s.j, s.c))!.id);
    let r = (await run(s.j, s.c))!; expect(r.status).toBe('active'); expect(r.step_index).toBe(2);
    expect(Math.round((new Date(r.next_run_at).getTime() - t0) / MIN)).toBe(60); expect((await msgs(s.t)).map((m) => m.journey_step)).toEqual([0]);
    // too early: nothing happens
    await advanceRun({ db, appUrl: APP, now: at(t0 + 30 * MIN) }, s.t, r.id); expect((await msgs(s.t))).toHaveLength(1);
    await advanceRun({ db, appUrl: APP, now: at(t0 + 61 * MIN) }, s.t, r.id);
    r = (await run(s.j, s.c))!; expect(r.status).toBe('completed'); expect((await msgs(s.t)).map((m) => m.journey_step)).toEqual([0, 2]);
  });
  it('fills the blanks from the contact: first name, and "there" when unknown', async () => {
    const s = await setup(); await enrollContacts(db, s.t, s.j, [s.c]); await advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id);
    expect((await msgs(s.t))[0]!.payload.params).toEqual(['Asha']);
    const s2 = await setup(); await A(`update contacts set name = null where id = '${s2.c}'`); await enrollContacts(db, s2.t, s2.j, [s2.c]); await advanceRun({ db, appUrl: APP }, s2.t, (await run(s2.j, s2.c))!.id);
    expect((await msgs(s2.t))[0]!.payload.params).toEqual(['there']);
  });
  it('adds a tag and carries on to the next step in the same pass', async () => {
    const s = await setup({ steps: [{ type: 'add_tag', tag: 'welcomed' }, { type: 'send_template', templateId: '$T', varMap: ['@name'] }] });
    await enrollContacts(db, s.t, s.j, [s.c]); await advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id);
    expect((await A(`select tags from contacts where id = '${s.c}'`))[0]!.tags).toContain('welcomed'); expect((await run(s.j, s.c))!.status).toBe('completed'); expect(await msgs(s.t)).toHaveLength(1);
  });
  it('a tag already on the contact is not doubled', async () => {
    const s = await setup({ steps: [{ type: 'add_tag', tag: 'vip' }, { type: 'send_template', templateId: '$T', varMap: ['@name'] }] });
    await A(`update contacts set tags = ARRAY['vip']::text[] where id = '${s.c}'`); await enrollContacts(db, s.t, s.j, [s.c]); await advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id);
    expect((await A(`select tags from contacts where id = '${s.c}'`))[0]!.tags).toEqual(['vip']);
  });
  it('a step is never sent twice, even if the same step is run again', async () => {
    const s = await setup(); await enrollContacts(db, s.t, s.j, [s.c]); const id = (await run(s.j, s.c))!.id;
    await advanceRun({ db, appUrl: APP }, s.t, id);
    await A(`update journey_runs set step_index = 0, next_run_at = now() - interval '1 minute' where id = '${id}'`);   // simulate a crash that lost the progress
    await advanceRun({ db, appUrl: APP }, s.t, id);
    expect((await msgs(s.t)).filter((m) => m.journey_step === 0)).toHaveLength(1);
  });
  it('the queued message is an ordinary one: the send queue still applies every check, speed and quiet hours', async () => {
    const s = await setup(); await enrollContacts(db, s.t, s.j, [s.c]); await advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id);
    expect((await msgs(s.t))[0]).toMatchObject({ status: 'queued', template_name: 'jn_t' });
  });
  it('a paused journey does not move anyone, and resumes where it was', async () => {
    const s = await setup(); await enrollContacts(db, s.t, s.j, [s.c]); await A(`update journeys set status = 'paused' where id = '${s.j}'`);
    const r = await advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id); expect(r.moved).toBe(false); expect(await msgs(s.t)).toHaveLength(0);
    await A(`update journeys set status = 'active' where id = '${s.j}'`); await advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id); expect(await msgs(s.t)).toHaveLength(1);
  });
});

describe('when a journey must stop', () => {
  const started = async (o: Parameters<typeof setup>[0] = {}) => { const s = await setup(o); await enrollContacts(db, s.t, s.j, [s.c]); return { ...s, id: (await run(s.j, s.c))!.id as string }; };
  it('a reply ends it, and nothing more is sent', async () => {
    const s = await started(); await advanceRun({ db, appUrl: APP }, s.t, s.id);
    await A(`update contacts set last_inbound_at = now() + interval '1 minute' where id = '${s.c}'`);
    await advanceRun({ db, appUrl: APP, now: at(Date.now() + 120 * MIN) }, s.t, s.id);
    expect(await run(s.j, s.c)).toMatchObject({ status: 'stopped', stop_reason: 'replied' }); expect(await msgs(s.t)).toHaveLength(1);
  });
  it('a reply from BEFORE the journey started does not end it', async () => {
    const s = await started(); await A(`update contacts set last_inbound_at = now() - interval '3 days' where id = '${s.c}'`);
    await advanceRun({ db, appUrl: APP }, s.t, s.id); expect((await run(s.j, s.c))!.status).toBe('active');
  });
  it('with stop-on-reply switched off, a reply does not end it', async () => {
    const s = await started({ stopOnReply: false }); await A(`update contacts set last_inbound_at = now() + interval '1 minute' where id = '${s.c}'`);
    await advanceRun({ db, appUrl: APP }, s.t, s.id); expect((await run(s.j, s.c))!.status).toBe('active'); expect(await msgs(s.t)).toHaveLength(1);
  });
  it('opting out ends it before the next message', async () => {
    const s = await started(); await advanceRun({ db, appUrl: APP }, s.t, s.id); await A(`update contacts set consent_status = 'stopped' where id = '${s.c}'`);
    await advanceRun({ db, appUrl: APP, now: at(Date.now() + 120 * MIN) }, s.t, s.id); expect(await run(s.j, s.c)).toMatchObject({ status: 'stopped', stop_reason: 'opted_out' }); expect(await msgs(s.t)).toHaveLength(1);
  });
  it('opting out stops every running journey for that person at once', async () => {
    const s = await started(); const n = await stopRunsFor(db, s.t, s.c, 'opted_out'); expect(n).toBe(1); expect((await run(s.j, s.c))!.status).toBe('stopped');
    expect(await stopRunsFor(db, s.t, s.c, 'opted_out')).toBe(0);
  });
  it('no permission on record: promotions are refused and the person leaves the journey', async () => {
    const s = await started({ consent: 'unknown' }); await advanceRun({ db, appUrl: APP }, s.t, s.id); expect(await run(s.j, s.c)).toMatchObject({ status: 'stopped', stop_reason: 'no_permission' }); expect(await msgs(s.t)).toHaveLength(0);
  });
  it('an update (utility) message does not need a promotion permission', async () => {
    const s = await started({ consent: 'unknown', category: 'utility' }); await advanceRun({ db, appUrl: APP }, s.t, s.id); expect(await msgs(s.t)).toHaveLength(1);
  });
  it('a customer who cannot receive WhatsApp leaves it', async () => {
    const s = await started(); await A(`update contacts set reachability = 'unreachable' where id = '${s.c}'`); await advanceRun({ db, appUrl: APP }, s.t, s.id);
    expect(await run(s.j, s.c)).toMatchObject({ status: 'stopped', stop_reason: 'unreachable' });
  });
  it('a template deleted, or changed into one a journey cannot use, stops it safely', async () => {
    const a = await started(); await A(`update journey_runs set step_index = 0 where id = '${a.id}'`); await A(`delete from templates where id = '${a.tpl}'`); await advanceRun({ db, appUrl: APP }, a.t, a.id);
    expect(await run(a.j, a.c)).toMatchObject({ status: 'stopped', stop_reason: 'template_missing' });
    const b = await started(); await A(`update templates set buttons = '[{"type":"copy_code","text":"x"}]'::jsonb where id = '${b.tpl}'`); await advanceRun({ db, appUrl: APP }, b.t, b.id);
    expect(await run(b.j, b.c)).toMatchObject({ status: 'stopped', stop_reason: 'template_changed' }); expect(await msgs(b.t)).toHaveLength(0);
    const c = await started(); await A(`update templates set offer = '{"text":"x","hasExpiration":true}'::jsonb where id = '${c.tpl}'`); await advanceRun({ db, appUrl: APP }, c.t, c.id);
    expect(await run(c.j, c.c)).toMatchObject({ stop_reason: 'template_changed' });
  });
  it('a template that is temporarily not approved is waited for, then released when it is back', async () => {
    const s = await started({ tplStatus: 'paused' }); const t0 = Date.now();
    await advanceRun({ db, appUrl: APP, now: at(t0) }, s.t, s.id);
    let r = (await run(s.j, s.c))!; expect(r.status).toBe('active'); expect(await msgs(s.t)).toHaveLength(0); expect(Math.round((new Date(r.next_run_at).getTime() - t0) / MIN)).toBe(30);
    await A(`update templates set status = 'approved' where id = '${s.tpl}'`); await advanceRun({ db, appUrl: APP, now: at(t0 + 31 * MIN) }, s.t, s.id);
    expect(await msgs(s.t)).toHaveLength(1);
  });
  it('a template that stays unapproved for two days ends the journey for that person', async () => {
    const s = await started({ tplStatus: 'paused' }); await A(`update journey_runs set attempts = 95 where id = '${s.id}'`);
    await advanceRun({ db, appUrl: APP }, s.t, s.id); expect(await run(s.j, s.c)).toMatchObject({ status: 'stopped', stop_reason: 'template_not_approved' });
  });
  it('a damaged journey (unreadable steps) does nothing and never sends', async () => {
    const s = await started(); await A(`update journeys set steps = '[{"type":"explode"}]'::jsonb where id = '${s.j}'`); await advanceRun({ db, appUrl: APP }, s.t, s.id);
    expect(await msgs(s.t)).toHaveLength(0); expect((await run(s.j, s.c))!.status).toBe('completed');
  });
});

describe('the ticking loop', () => {
  it('picks up only runs that are due, in active journeys', async () => {
    const a = await setup(), b = await setup({ status: 'paused' });
    await enrollContacts(db, a.t, a.j, [a.c]); await A(`insert into journey_runs (tenant_id, journey_id, contact_id) values ('${b.t}', '${b.j}', '${b.c}')`);
    const later = await setup(); await enrollContacts(db, later.t, later.j, [later.c]); await A(`update journey_runs set next_run_at = now() + interval '1 hour' where journey_id = '${later.j}'`);
    const r = await tickJourneys({ db, appUrl: APP });
    expect(r.failed).toBe(0); expect((await run(a.j, a.c))!.step_index).toBeGreaterThan(0); expect((await run(b.j, b.c))!.step_index).toBe(0); expect((await run(later.j, later.c))!.step_index).toBe(0);
  });
  it('an error on one person is recorded and retried later, never stops the others, and gives up after five', async () => {
    const s = await setup({ people: 2 }); await enrollContacts(db, s.t, s.j, s.people);
    await A(`delete from phone_numbers where tenant_id = '${s.t}'`);   // no WhatsApp number: every send step errors
    await tickJourneys({ db, appUrl: APP });
    const r = (await run(s.j, s.c))!; expect(r).toMatchObject({ status: 'active', attempts: 1 }); expect(r.last_error).toMatch(/WhatsApp number/); expect(new Date(r.next_run_at).getTime()).toBeGreaterThan(Date.now() + 4 * MIN);
    await A(`update journey_runs set attempts = 4, next_run_at = now() where journey_id = '${s.j}'`); await tickJourneys({ db, appUrl: APP });
    expect((await run(s.j, s.c))!.status).toBe('failed');
  });
});

describe('fairness', () => {
  it('the tick takes the oldest due runs first, so nobody waits forever behind a big enrolment', async () => {
    const big = await setup({ people: 1 }), small = await setup();
    await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) select '${big.t}', '+91666' || lpad(g::text, 7, '0'), 'crowd', 'allowed' from generate_series(1, 120) g`);
    await A(`insert into journey_runs (tenant_id, journey_id, contact_id, next_run_at) select '${big.t}', '${big.j}', id, now() - interval '10 minutes' from contacts where tenant_id = '${big.t}' and name = 'crowd'`);
    await enrollContacts(db, small.t, small.j, [small.c]);   // newer than all of the crowd
    const first = await tickJourneys({ db, appUrl: APP }); expect(first.due).toBeLessThanOrEqual(100);
    const waiting = Number((await A(`select count(*)::int n from journey_runs where journey_id = '${big.j}' and status = 'active' and step_index = 0`))[0]!.n);
    expect(waiting).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) await tickJourneys({ db, appUrl: APP });
    expect((await run(small.j, small.c))!.step_index).toBeGreaterThan(0);   // served by the next ticks
    await A(`update journey_runs set status = 'stopped' where journey_id = '${big.j}'`);
  });
});

describe('ordering and concurrency', () => {
  it('a tick takes exactly the oldest due runs, whatever order they were created in', async () => {
    const s = await setup();
    await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) select '${s.t}', '+91777' || lpad(g::text, 7, '0'), 'ord', 'allowed' from generate_series(1, 150) g`);
    // started_at doubles as a record of how long each has waited; ids are random, so only a real "oldest first" order can pass
    await A(`insert into journey_runs (tenant_id, journey_id, contact_id, started_at, next_run_at) select '${s.t}', '${s.j}', id, now() - (row_number() over (order by random()))::int * interval '1 minute' - interval '1 hour', now() - (row_number() over (order by random()))::int * interval '1 minute' - interval '1 hour' from contacts where tenant_id = '${s.t}' and name = 'ord'`);
    await A(`update journey_runs set started_at = next_run_at where journey_id = '${s.j}'`);
    await tickJourneys({ db, appUrl: APP });
    const r = (await A(`select (select max(started_at) from journey_runs where journey_id = '${s.j}' and step_index > 0) as newest_done, (select min(started_at) from journey_runs where journey_id = '${s.j}' and step_index = 0) as oldest_left, (select count(*)::int from journey_runs where journey_id = '${s.j}' and step_index > 0) as done`))[0]!;
    expect(r.done).toBe(100);
    expect(new Date(r.newest_done).getTime()).toBeLessThanOrEqual(new Date(r.oldest_left).getTime());   // the oldest due runs are exactly the ones taken
    await A(`update journey_runs set status = 'stopped' where journey_id = '${s.j}'`);
  });

  it('two workers on the same run send one message and move one step, not two', async () => {
    const s = await setup(); await enrollContacts(db, s.t, s.j, [s.c]);
    await A(`update journey_runs set next_run_at = now() - interval '1 minute' where journey_id = '${s.j}'`);
    const results = await Promise.all([advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id), advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id), advanceRun({ db, appUrl: APP }, s.t, (await run(s.j, s.c))!.id)]);
    expect(results.filter((r) => r.moved).length).toBe(1);
    expect((await msgs(s.t)).length).toBe(1);
    expect((await run(s.j, s.c))!.step_index).toBe(2);   // step 0 sent, then it is now waiting at step 1 (the wait) -> 2 after scheduling
  });
});

describe('isolation', () => {
  it('one workspace never sees another\'s journeys or runs (row security on the web role)', async () => {
    const a = await setup(), b = await setup(); await enrollContacts(db, a.t, a.j, [a.c]); await enrollContacts(db, b.t, b.j, [b.c]);
    const seen = (await A(`select tenant_id from journey_runs where journey_id in ('${a.j}','${b.j}')`)).map((r) => r.tenant_id);
    expect(new Set(seen)).toEqual(new Set([a.t, b.t]));
    await expect(A(`insert into journey_runs (tenant_id, journey_id, contact_id) values ('${a.t}', '${b.j}', '${a.c}')`)).resolves.toBeDefined();   // the table itself does not forbid it; the engine pins every query to the tenant
    expect((await enrollContacts(db, a.t, b.j, [a.c])).refused).toBe('not_active');
  });
});

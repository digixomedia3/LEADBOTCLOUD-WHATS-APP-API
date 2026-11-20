import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '@lbc/db';
import { launchCampaign } from '../src/campaigns';
import { dueReleases, releaseWinner } from '../src/ab-release';
import { estimateCost } from '@lbc/shared';
import { encryptSecret } from '@lbc/meta';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db, A = admin.client.unsafe;
const KEY = randomBytes(32).toString('base64');
afterAll(async () => {
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'HR %')`);
  await A(`delete from tenants where name like 'HR %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});

type Tpl = { name?: string; category?: string; status?: string; body?: string; buttons?: object[]; offer?: object | null };
async function setup(o: { people?: number; pct?: number; b?: Tpl | null; a?: Tpl; aVars?: string[]; bVars?: string[]; stopped?: number } = {}) {
  const t = randomUUID(), tag = t.slice(0, 8);
  await A(`insert into tenants (id, name, quiet_hours_enabled) values ('${t}', 'HR ${tag}', false)`);
  await A(`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values ('${t}', 'ab-waba-${tag}', '${encryptSecret('T', KEY)}', 'valid', 'ok')`);
  const acc = (await A(`select id from meta_accounts where tenant_id = '${t}'`))[0]!.id;
  await A(`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values ('${t}', '${acc}', 'ab-pn-${tag}', '+91 90000 00000')`);
  const mk = async (x: Tpl, dflt: string) => {
    const cat = x.category ?? 'marketing';
    return (await A(`insert into templates (tenant_id, name, language, category, status, body, category_current, buttons, offer) values ('${t}', '${x.name ?? dflt}', 'en', '${cat}', '${x.status ?? 'approved'}', '${x.body ?? 'Hello {{1}}, a note for you.'}', '${cat}', '${JSON.stringify(x.buttons ?? [])}'::jsonb, ${x.offer ? `'${JSON.stringify(x.offer)}'::jsonb` : 'null'}) returning id`))[0]!.id as string;
  };
  const ta = await mk(o.a ?? {}, 'ab_a');
  const tb = o.b === null ? null : await mk(o.b ?? { body: 'Hi {{1}}, version B here.' }, 'ab_b');
  const g = (await A(`insert into contact_groups (tenant_id, name) values ('${t}', 'g') returning id`))[0]!.id as string;
  const n = o.people ?? 20;
  for (let i = 0; i < n; i++) {
    const c = (await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${t}', '+9190${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}', 'Pat Lee ${i}', '${i < (o.stopped ?? 0) ? 'stopped' : 'allowed'}') returning id`))[0]!.id;
    await A(`insert into contact_group_members (tenant_id, group_id, contact_id) values ('${t}', '${g}', '${c}')`);
  }
  const ab = tb ? `, ab_template_id = '${tb}', ab_var_map = '${JSON.stringify(o.bVars ?? ['Bee'])}'::jsonb, ab_percent_b = ${o.pct ?? 50}` : '';
  const camp = (await A(`insert into campaigns (tenant_id, name, template_id, group_ids, status, scheduled_at, repeat, var_map) values ('${t}', 'HR', '${ta}', ARRAY['${g}']::uuid[], 'scheduled', now() - interval '1 minute', 'none', '${JSON.stringify(o.aVars ?? ['@name'])}'::jsonb) returning id`))[0]!.id as string;
  if (ab) await A(`update campaigns set ${ab.slice(2)} where id = '${camp}'`);
  return { t, camp, ta, tb };
}
const recipsOLD = (camp: string) => A(`select r.version, r.state, m.template_name, m.payload from campaign_recipients r left join messages m on m.campaign_recipient_id = r.id where r.campaign_id = '${camp}'`) as unknown as Promise<{ version: string; state: string; template_name: string | null; payload: { params: string[] } }[]>;


/** Sets up a campaign that tests on `test` percent and keeps the rest back for the winner. */
async function hold(o: { people?: number; test?: number; stopped?: number; offerEnds?: string } = {}) {
  const s = await setup({ people: o.people ?? 20, stopped: o.stopped ?? 0, pct: 50 });
  await A(`update campaigns set ab_hold_rest = true, ab_test_pct = ${o.test ?? 20}, ab_percent_b = 50 where id = '${s.camp}'`);
  return s;
}
const by = (camp: string) => A(`select r.contact_id, r.version, r.phase, r.state, r.reason, m.template_name, m.payload from campaign_recipients r left join messages m on m.campaign_recipient_id = r.id where r.campaign_id = '${camp}'`) as unknown as Promise<{ contact_id: string; version: string; phase: string; state: string; reason: string | null; template_name: string | null; payload: { params: string[] } | null }[]>;
const request = (camp: string, v: 'a' | 'b') => A(`update campaigns set ab_release_version = '${v}', ab_release_requested_at = now() where id = '${camp}'`);
const campaign = async (camp: string) => (await A(`select status, ab_released_at, ab_release_version, ab_release_error, est_cost_paise from campaigns where id = '${camp}'`))[0] as { status: string; ab_released_at: Date | null; ab_release_version: string | null; ab_release_error: string | null; est_cost_paise: number };
const audit = (t: string) => A(`select action, after from audit_log where tenant_id = '${t}' and action = 'campaign.ab_released'`) as unknown as Promise<{ action: string; after: { version: string; queued: number; skipped: number } }[]>;

describe('test first, hold the rest: launch', () => {
  it('messages only the test group (split half and half); everyone else is held with no message', async () => {
    const s = await hold({ people: 40, test: 25 }); const r = await launchCampaign(db, s.t, s.camp);
    expect(r.status).toBe('running'); const rows = await by(s.camp);
    const test = rows.filter((x) => x.phase === 'test'), rest = rows.filter((x) => x.phase === 'rest');
    expect(test.length).toBe(10); expect(rest.length).toBe(30);
    expect(test.every((x) => x.state === 'queued' && x.template_name)).toBe(true);
    expect(test.filter((x) => x.version === 'a').length).toBe(5); expect(test.filter((x) => x.version === 'b').length).toBe(5);
    expect(rest.every((x) => x.state === 'held' && x.template_name === null)).toBe(true);
    expect((await A(`select count(*)::int n from messages where tenant_id = '${s.t}'`))[0]!.n).toBe(10);       // nobody held has a message
  });

  it('never tests on more than half, and always on at least 2, whatever the percent', async () => {
    const small = await hold({ people: 6, test: 10 }); await launchCampaign(db, small.t, small.camp);
    expect((await by(small.camp)).filter((x) => x.phase === 'test').length).toBe(2);
    const tiny = await hold({ people: 4, test: 50 }); await launchCampaign(db, tiny.t, tiny.camp);
    const t = await by(tiny.camp); expect(t.filter((x) => x.phase === 'test').length).toBe(2); expect(t.filter((x) => x.state === 'held').length).toBe(2);
  });

  it('opted-out people are skipped, not held, and do not use up test places', async () => {
    const s = await hold({ people: 30, stopped: 10, test: 50 }); await launchCampaign(db, s.t, s.camp); const rows = await by(s.camp);
    expect(rows.filter((x) => x.state === 'skipped').length).toBe(10); expect(rows.filter((x) => x.phase === 'test' && x.state === 'queued').length).toBe(10); expect(rows.filter((x) => x.state === 'held').length).toBe(10);
  });

  it('the campaign without the hold option still messages everyone at once (nothing changed for normal tests)', async () => {
    const s = await setup({ people: 20, pct: 50 }); await launchCampaign(db, s.t, s.camp);
    const rows = await by(s.camp); expect(rows.every((x) => x.state === 'queued')).toBe(true); expect(rows.filter((x) => x.state === 'held').length).toBe(0);
  });
});

describe('test first, hold the rest: release', () => {
  it('sends the chosen version, with its own template and blanks, to everyone held, once', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp); await request(s.camp, 'b');
    const r = await releaseWinner(db, s.t, s.camp); expect(r).toMatchObject({ status: 'released', queued: 16, skipped: 0 });
    const rows = await by(s.camp); const rest = rows.filter((x) => x.phase === 'rest');
    expect(rest.every((x) => x.state === 'queued' && x.version === 'b' && x.template_name === 'ab_b' && x.payload!.params[0] === 'Bee')).toBe(true);
    expect(rows.filter((x) => x.state === 'held').length).toBe(0);
    expect((await A(`select count(*)::int n from messages where tenant_id = '${s.t}'`))[0]!.n).toBe(20);     // 4 test + 16 winners, one message each
    const c = await campaign(s.camp); expect(c.status).toBe('running'); expect(c.ab_released_at).not.toBeNull();
    expect((await audit(s.t))[0]!.after).toMatchObject({ version: 'b', queued: 16 });
  });

  it('version A can be chosen too, and uses the first template and its blanks', async () => {
    const s = await hold({ people: 12, test: 20 }); await launchCampaign(db, s.t, s.camp); await request(s.camp, 'a'); await releaseWinner(db, s.t, s.camp);
    const rest = (await by(s.camp)).filter((x) => x.phase === 'rest'); expect(rest.length).toBe(10);
    expect(rest.every((x) => x.version === 'a' && x.template_name === 'ab_a' && /^Pat/.test(x.payload!.params[0]!))).toBe(true);
  });

  it('is exactly-once: a second run, or two at the same time, sends nothing more', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp); await request(s.camp, 'a');
    const runs = await Promise.all([releaseWinner(db, s.t, s.camp), releaseWinner(db, s.t, s.camp), releaseWinner(db, s.t, s.camp)]);
    expect(runs.filter((r) => r.status === 'released').length).toBe(1); expect(runs.filter((r) => r.status === 'nothing_to_do').length).toBe(2);
    expect((await releaseWinner(db, s.t, s.camp)).status).toBe('nothing_to_do');
    expect((await A(`select count(*)::int n from messages where tenant_id = '${s.t}'`))[0]!.n).toBe(20);
    expect((await audit(s.t)).length).toBe(1);
  });

  it('does nothing until a version has been chosen, and nothing for a campaign without the hold option', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp);
    expect((await releaseWinner(db, s.t, s.camp)).status).toBe('nothing_to_do'); expect((await by(s.camp)).filter((x) => x.state === 'held').length).toBe(16);
    expect((await dueReleases(db)).some((d) => d.id === s.camp)).toBe(false);
    const n = await setup({ people: 10, pct: 50 }); await launchCampaign(db, n.t, n.camp); await A(`update campaigns set ab_release_version = 'a', ab_release_requested_at = now() where id = '${n.camp}'`).catch(() => undefined);
    expect((await releaseWinner(db, n.t, n.camp)).status).toBe('nothing_to_do');
  });

  it('checks permission again NOW: someone who opted out after the test is skipped with the reason, and never messaged', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp);
    const held = (await by(s.camp)).filter((x) => x.state === 'held').map((x) => x.contact_id);
    await A(`update contacts set consent_status = 'stopped' where id in ('${held[0]}', '${held[1]}')`);
    await A(`update contacts set reachability = 'unreachable' where id = '${held[2]}'`);
    await A(`update contacts set freq_cap_hold_until = now() + interval '1 day' where id = '${held[3]}'`);
    await request(s.camp, 'b'); const r = await releaseWinner(db, s.t, s.camp); expect(r).toMatchObject({ status: 'released', queued: 12, skipped: 4 });
    const rows = await by(s.camp); const bad = rows.filter((x) => held.slice(0, 4).includes(x.contact_id));
    expect(bad.every((x) => x.state === 'skipped' && x.template_name === null)).toBe(true);
    expect(bad.map((x) => x.reason).sort()).toEqual(['Cannot receive WhatsApp messages', 'Meta limited promotional messages to this customer today', 'Opted out', 'Opted out']);
    expect((await audit(s.t))[0]!.after).toMatchObject({ queued: 12, skipped: 4 });
  });

  it('a held person whose contact was deleted is skipped, and the rest still go out', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp);
    const held = (await by(s.camp)).filter((x) => x.state === 'held'); await A(`delete from contacts where id = '${held[0]!.contact_id}'`);
    await request(s.camp, 'a'); const r = await releaseWinner(db, s.t, s.camp); expect(r.status).toBe('released'); expect(r.queued).toBe(15); expect(r.skipped).toBe(1);
    expect((await A(`select count(*)::int n from campaign_recipients where campaign_id = '${s.camp}' and state = 'held'`))[0]!.n).toBe(0);
  });

  it('a spend cap that the full send would break stops the release with a clear reason, sends nothing, and lets the owner try again', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp); await A(`update campaigns set spend_cap_paise = 100 where id = '${s.camp}'`); await request(s.camp, 'a');
    const r = await releaseWinner(db, s.t, s.camp); expect(r).toMatchObject({ status: 'refused', reason: 'spend_cap', queued: 0 });
    expect((await A(`select count(*)::int n from messages where tenant_id = '${s.t}'`))[0]!.n).toBe(4);       // only the test messages exist
    expect((await by(s.camp)).filter((x) => x.state === 'held').length).toBe(16);
    const c = await campaign(s.camp); expect(c.ab_release_error).toBe('spend_cap'); expect(c.ab_release_version).toBeNull(); expect(c.ab_released_at).toBeNull();
    await A(`update campaigns set spend_cap_paise = null where id = '${s.camp}'`); await request(s.camp, 'a');       // the owner fixes it and asks again
    expect((await releaseWinner(db, s.t, s.camp)).status).toBe('released'); expect((await campaign(s.camp)).ab_release_error).toBeNull();
  });

  it.each([
    ['template no longer approved', "update templates set status = 'rejected' where id = '{B}'", 'template_not_approved'],
    ['WhatsApp connection no longer valid', "update meta_accounts set token_status = 'invalid' where tenant_id = '{T}'", 'reconnect'],
    ['WhatsApp access revoked', "update meta_accounts set token_status = 'revoked' where tenant_id = '{T}'", 'reconnect'],
    ['account restricted', "update meta_accounts set health_state = 'restricted' where tenant_id = '{T}'", 'account_restricted'],
    ['payment failing', "update meta_accounts set payment_method_status = 'failing' where tenant_id = '{T}'", 'payment_banner'],
    ['number removed', "delete from phone_numbers where tenant_id = '{T}'", 'not_connected'],
  ])('refuses and sends nothing when: %s', async (_n, stmt, reason) => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp);
    await A(stmt.replace('{B}', String(s.tb)).replace('{T}', s.t)); await request(s.camp, 'b');
    const r = await releaseWinner(db, s.t, s.camp); expect(r.status).toBe('refused'); expect(r.reason).toBe(reason);
    expect((await by(s.camp)).filter((x) => x.state === 'held').length).toBe(16); expect((await A(`select count(*)::int n from messages where tenant_id = '${s.t}'`))[0]!.n).toBe(4);
  });

  it('the winner template must be approved, but the OTHER version does not matter', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp);
    await A(`update templates set status = 'rejected' where id = '${s.ta}'`); await request(s.camp, 'b');
    expect((await releaseWinner(db, s.t, s.camp)).status).toBe('released');      // A is rejected but B, the winner, is fine
  });

  it("another workspace's held people are never touched", async () => {
    const mine = await hold({ people: 20, test: 20 }), other = await hold({ people: 20, test: 20 });
    await launchCampaign(db, mine.t, mine.camp); await launchCampaign(db, other.t, other.camp); await request(mine.camp, 'a');
    await releaseWinner(db, mine.t, mine.camp);
    expect((await by(other.camp)).filter((x) => x.state === 'held').length).toBe(16);
    await request(other.camp, 'a'); expect((await releaseWinner(db, mine.t, other.camp)).status).toBe('nothing_to_do');      // asking with the wrong workspace finds nothing
    expect((await by(other.camp)).filter((x) => x.state === 'held').length).toBe(16);
  });

  it('released people keep a rest phase, so they never leak into the test comparison; the report roll-up closes the campaign when done', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp); await request(s.camp, 'a'); await releaseWinner(db, s.t, s.camp);
    const rows = await by(s.camp); expect(rows.filter((x) => x.phase === 'test').length).toBe(4); expect(rows.filter((x) => x.phase === 'rest').length).toBe(16);
    await A(`update campaign_recipients set state = 'sent' where campaign_id = '${s.camp}' and state = 'queued'`);
    const { rollupCampaigns } = await import('../src/campaigns'); await rollupCampaigns(db); expect((await campaign(s.camp)).status).toBe('completed');
  });

  it('a campaign still holding people is NOT closed by the roll-up (held is not "waiting to send")', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp);
    await A(`update campaign_recipients set state = 'sent' where campaign_id = '${s.camp}' and state = 'queued'`);
    const { rollupCampaigns } = await import('../src/campaigns'); await rollupCampaigns(db);
    const c = await campaign(s.camp); expect(['running', 'completed']).toContain(c.status);
    await request(s.camp, 'a'); expect((await releaseWinner(db, s.t, s.camp)).status).toBe('released');       // works whether or not the roll-up had closed it
  });
});

describe('gaps found by deliberately breaking the code', () => {
  it('the spend cap counts people already sent to in the test, not just the ones about to be sent', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp);          // 4 test messages, 16 held
    const restOnly = estimateCost(16, 'marketing').totalPaise, all = estimateCost(20, 'marketing').totalPaise; expect(all).toBeGreaterThan(restOnly);
    await A(`update campaigns set spend_cap_paise = ${restOnly} where id = '${s.camp}'`); await request(s.camp, 'a');   // enough for the 16 alone, not for 20 in total
    expect(await releaseWinner(db, s.t, s.camp)).toMatchObject({ status: 'refused', reason: 'spend_cap' });
    await A(`update campaigns set spend_cap_paise = ${all} where id = '${s.camp}'`); await request(s.camp, 'a');
    expect((await releaseWinner(db, s.t, s.camp)).status).toBe('released');                                              // exactly the total fits
  });

  it('a campaign the roll-up already closed is reopened so the new messages are tracked and it closes again when they are done', async () => {
    const s = await hold({ people: 20, test: 20 }); await launchCampaign(db, s.t, s.camp);
    await A(`update campaigns set status = 'completed', completed_at = now() where id = '${s.camp}'`); await request(s.camp, 'a'); await releaseWinner(db, s.t, s.camp);
    const c = (await A(`select status, completed_at from campaigns where id = '${s.camp}'`))[0]!; expect(c.status).toBe('running'); expect(c.completed_at).toBeNull();
  });

  it('an offer that has ended since the test stops the release, so nobody is sent a dead offer', async () => {
    const offer = { text: 'Hurry!', hasExpiration: true };
    const s = await setup({ people: 20, pct: 50, a: { offer }, b: { body: 'Hi {{1}}, B.', offer } });
    await A(`update campaigns set ab_hold_rest = true, ab_test_pct = 20, ab_percent_b = 50, offer_expires_at = now() + interval '3 hours' where id = '${s.camp}'`);
    expect((await launchCampaign(db, s.t, s.camp)).status).toBe('running');
    await A(`update campaigns set offer_expires_at = now() - interval '1 minute' where id = '${s.camp}'`); await request(s.camp, 'a');
    expect(await releaseWinner(db, s.t, s.camp)).toMatchObject({ status: 'refused', reason: 'offer_ended' });
    expect((await by(s.camp)).filter((x) => x.state === 'held').length).toBe(16);
    await A(`update campaigns set offer_expires_at = null where id = '${s.camp}'`); await request(s.camp, 'a');
    expect(await releaseWinner(db, s.t, s.camp)).toMatchObject({ status: 'refused', reason: 'offer_time_missing' });
  });

  it('at launch, people who cannot or must not be messaged are skipped with the reason, not held for later', async () => {
    const s = await setup({ people: 20, pct: 50 }); await A(`update campaigns set ab_hold_rest = true, ab_test_pct = 50, ab_percent_b = 50 where id = '${s.camp}'`);
    const ids = (await A(`select id from contacts where tenant_id = '${s.t}' order by id`)).map((x) => x.id as string);
    await A(`update contacts set reachability = 'unreachable' where id = '${ids[0]}'`); await A(`update contacts set consent_status = 'unknown' where id = '${ids[1]}'`);
    await A(`update contacts set freq_cap_hold_until = now() + interval '1 day' where id = '${ids[2]}'`);
    await launchCampaign(db, s.t, s.camp); const rows = await by(s.camp);
    const bad = rows.filter((x) => [ids[0], ids[1], ids[2]].includes(x.contact_id));
    expect(bad.every((x) => x.state === 'skipped')).toBe(true); expect(bad.map((x) => x.reason).sort()).toEqual(['Cannot receive WhatsApp messages', 'Meta limited promotional messages to this customer today', 'No permission on record']);
    expect(rows.filter((x) => x.state === 'held').length + rows.filter((x) => x.phase === 'test' && x.state === 'queued').length).toBe(17);
  });

  it('the database itself refuses a release on a campaign that is not set up to hold people, or a test share outside 10 to 50', async () => {
    const plain = await setup({ people: 10, pct: 50 });
    await expect(A(`update campaigns set ab_release_version = 'a', ab_release_requested_at = now() where id = '${plain.camp}'`)).rejects.toThrow(/campaigns_ab_hold_chk/);
    await expect(A(`update campaigns set ab_hold_rest = true, ab_test_pct = 60, ab_percent_b = 50 where id = '${plain.camp}'`)).rejects.toThrow(/campaigns_ab_hold_chk/);
    await expect(A(`update campaigns set ab_hold_rest = true, ab_test_pct = 5, ab_percent_b = 50 where id = '${plain.camp}'`)).rejects.toThrow(/campaigns_ab_hold_chk/);
    await expect(A(`update campaigns set ab_hold_rest = true, ab_test_pct = 20, ab_percent_b = 30 where id = '${plain.camp}'`)).rejects.toThrow(/campaigns_ab_hold_chk/);
    const s = await hold({ people: 10, test: 20 }); await launchCampaign(db, s.t, s.camp);
    await expect(A(`update campaigns set ab_release_version = 'c' where id = '${s.camp}'`)).rejects.toThrow(/ab_release_version_chk/);
    await expect(A(`update campaign_recipients set state = 'bogus' where campaign_id = '${s.camp}'`)).rejects.toThrow();
  });
});

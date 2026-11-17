import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '@lbc/db';
import { GraphClient, encryptSecret } from '@lbc/meta';
import { launchCampaign } from '../src/campaigns';
import { sendOne } from '../src/send';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db, A = admin.client.unsafe, KEY = randomBytes(32).toString('base64');
afterAll(async () => {
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'QH %')`);
  await A(`delete from tenants where name like 'QH %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
// IST is UTC+5:30, no daylight saving: these instants are exact.
const ist = (h: number, m = 0, day = 15) => new Date(Date.UTC(2026, 10, day, h, m) - 5.5 * 3600_000);
const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: 'http://127.0.0.1:9', appId: 'A', appSecret: 'S', timeoutMs: 500 });

async function setup(o: { category?: string; quiet?: boolean; people?: number; perMinute?: number | null; start?: number; end?: number } = {}) {
  const t = randomUUID(), tag = t.slice(0, 8);
  await A(`insert into tenants (id, name, quiet_hours_enabled, quiet_start_hour, quiet_end_hour) values ('${t}', 'QH ${tag}', ${o.quiet ?? true}, ${o.start ?? 21}, ${o.end ?? 9})`);
  await A(`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values ('${t}', 'qh-waba-${tag}', '${encryptSecret('T', KEY)}', 'valid', 'ok')`);
  const acc = (await A(`select id from meta_accounts where tenant_id = '${t}'`))[0]!.id;
  await A(`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values ('${t}', '${acc}', 'qh-pn-${tag}', '+91 90000 00000')`);
  const cat = o.category ?? 'marketing';
  const tpl = (await A(`insert into templates (tenant_id, name, language, category, status, body, category_current) values ('${t}', 'qh_t', 'en', '${cat}', 'approved', 'Hello {{1}}, a note for you today.', '${cat}') returning id`))[0]!.id as string;
  const g = (await A(`insert into contact_groups (tenant_id, name) values ('${t}', 'g') returning id`))[0]!.id as string;
  for (let i = 0; i < (o.people ?? 3); i++) {
    const c = (await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${t}', '+9190${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}', 'P${i}', 'allowed') returning id`))[0]!.id;
    await A(`insert into contact_group_members (tenant_id, group_id, contact_id) values ('${t}', '${g}', '${c}')`);
  }
  const camp = (await A(`insert into campaigns (tenant_id, name, template_id, group_ids, status, scheduled_at, repeat, var_map, send_per_minute) values ('${t}', 'QH', '${tpl}', ARRAY['${g}']::uuid[], 'scheduled', now() - interval '1 minute', 'none', '["@name"]'::jsonb, ${o.perMinute ?? 'null'}) returning id`))[0]!.id as string;
  return { t, camp };
}
const msgs = async (camp: string) => (await A(`select m.id, m.status, m.not_before, m.wamid from messages m join campaign_recipients r on r.id = m.campaign_recipient_id where r.campaign_id = '${camp}' order by m.created_at, m.id`)) as unknown as { id: string; status: string; not_before: Date | null; wamid: string | null }[];

describe('send speed at launch', () => {
  it('no limit: everything may go at once', async () => {
    const s = await setup({ people: 5 }); await launchCampaign(db, s.t, s.camp);
    for (const m of await msgs(s.camp)) expect(m.not_before).toBeNull();
  });
  it('a limit gives each message its turn, minute by minute, in order', async () => {
    const s = await setup({ people: 7, perMinute: 3 }); const t0 = Date.now(); await launchCampaign(db, s.t, s.camp);
    const m = await A(`select m.not_before from messages m join campaign_recipients r on r.id = m.campaign_recipient_id where r.campaign_id = '${s.camp}'`);
    const mins = m.map((x) => (x.not_before ? Math.round((new Date(x.not_before).getTime() - t0) / 60_000) : 0)).sort((a, b) => a - b);
    // 7 people at 3 a minute: three in the first minute, three in the next, one in the third. Which person is which does not matter.
    expect(mins).toEqual([0, 0, 0, 1, 1, 1, 2]);
  });
  it('a repeating campaign keeps its speed', async () => {
    const s = await setup({ perMinute: 50 }); await A(`update campaigns set repeat = 'weekly' where id = '${s.camp}'`); await launchCampaign(db, s.t, s.camp);
    expect((await A(`select send_per_minute from campaigns where tenant_id = '${s.t}' and id <> '${s.camp}'`))[0]!.send_per_minute).toBe(50);
  });
  it('the database refuses a nonsense speed', async () => {
    const s = await setup(); for (const bad of [0, -3, 6001]) await expect(A(`update campaigns set send_per_minute = ${bad} where id = '${s.camp}'`), String(bad)).rejects.toThrow();
  });
});

describe('the sender respects speed and quiet hours', () => {
  const one = async (o: Parameters<typeof setup>[0], at: Date) => {
    const s = await setup({ ...o, people: 1 }); await launchCampaign(db, s.t, s.camp); const [m] = await msgs(s.camp);
    const r = await sendOne({ db, graph: graph(), tokenKey: KEY, now: () => at }, s.t, m!.id);
    return { s, m: m!, r, after: (await msgs(s.camp))[0]! };
  };
  it('a promotion at night is held until 9 am, still queued, nothing sent or lost', async () => {
    const x = await one({}, ist(23, 30));
    expect(x.r.kind).toBe('deferred'); if (x.r.kind === 'deferred') { expect(x.r.why).toBe('quiet_hours'); expect(x.r.until).toEqual(ist(9, 0, 16)); }
    expect(x.after.status).toBe('queued'); expect(x.after.wamid).toBeNull(); expect(new Date(x.after.not_before!)).toEqual(ist(9, 0, 16));
  });
  it('early morning is still quiet and waits for 9 am the same day', async () => {
    const x = await one({}, ist(4, 0)); expect(x.r.kind === 'deferred' && x.r.until).toEqual(ist(9, 0));
  });
  it('during the day it goes ahead (and is not deferred)', async () => {
    const x = await one({}, ist(14, 0)); expect(x.r.kind).not.toBe('deferred');
  });
  it('an update (utility) message is NEVER held, even at 3 am', async () => {
    const x = await one({ category: 'utility' }, ist(3, 0)); expect(x.r.kind).not.toBe('deferred');
  });
  it('quiet hours switched off means promotions go at night', async () => {
    const x = await one({ quiet: false }, ist(23, 30)); expect(x.r.kind).not.toBe('deferred');
  });
  it('a TEST message to your own saved number is never held at night, but the same promotion to a customer is', async () => {
    const asTest = async (isTest: boolean) => {
      const s = await setup({ people: 1 }); await launchCampaign(db, s.t, s.camp); const [m] = await msgs(s.camp);
      await A(`update messages set is_test = ${isTest} where id = '${m!.id}'`);
      return sendOne({ db, graph: graph(), tokenKey: KEY, now: () => ist(23, 30) }, s.t, m!.id);
    };
    expect((await asTest(false)).kind).toBe('deferred');
    expect((await asTest(true)).kind).not.toBe('deferred');
  });
  it('a workspace can choose its own hours', async () => {
    const x = await one({ start: 22, end: 7 }, ist(8, 0)); expect(x.r.kind).not.toBe('deferred');
    const y = await one({ start: 22, end: 7 }, ist(6, 59)); expect(y.r.kind === 'deferred' && y.r.until).toEqual(ist(7, 0));
  });
  it('a message whose turn has not come yet waits for it (speed)', async () => {
    const s = await setup({ people: 1, quiet: false }); await launchCampaign(db, s.t, s.camp); const [m] = await msgs(s.camp);
    await A(`update messages set not_before = '${ist(15, 5).toISOString()}' where id = '${m!.id}'`);
    const r = await sendOne({ db, graph: graph(), tokenKey: KEY, now: () => ist(15, 0) }, s.t, m!.id);
    expect(r.kind === 'deferred' && r.why).toBe('speed'); expect((await msgs(s.camp))[0]!.status).toBe('queued');
    const r2 = await sendOne({ db, graph: graph(), tokenKey: KEY, now: () => ist(15, 6) }, s.t, m!.id); expect(r2.kind).not.toBe('deferred');
  });
  it('a typed reply in the 24-hour window is not a promotion and is never held at night', async () => {
    const s = await setup({ people: 1 }); await launchCampaign(db, s.t, s.camp);
    const ct = (await A(`select id from contacts where tenant_id = '${s.t}' limit 1`))[0]!.id;
    const conv = (await A(`update conversations set window_expires_at = now() + interval '1 hour' where tenant_id = '${s.t}' and contact_id = '${ct}' returning id`))[0]!.id;
    const mid = (await A(`insert into messages (tenant_id, conversation_id, direction, kind, body, status) values ('${s.t}', '${conv}', 'out', 'text', 'hello', 'queued') returning id`))[0]!.id as string;
    const r = await sendOne({ db, graph: graph(), tokenKey: KEY, now: () => ist(2, 0) }, s.t, mid); expect(r.kind).not.toBe('deferred');
  });
});

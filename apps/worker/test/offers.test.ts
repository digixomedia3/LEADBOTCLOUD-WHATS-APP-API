import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { GraphClient, encryptSecret } from '@lbc/meta';
import { launchCampaign } from '../src/campaigns';
import { sendOne, templateComponents } from '../src/send';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db, A = admin.client.unsafe, KEY = randomBytes(32).toString('base64');
afterAll(async () => {
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'OF %')`);
  await A(`delete from tenants where name like 'OF %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
const q = (t: string) => A(t);
const BUTTONS = [{ type: 'copy_code', text: 'Copy code', value: 'EXAMPLE' }, { type: 'url', text: 'Shop', value: 'https://shop.example.com' }];

async function setup(o: { offer?: object | null; buttons?: object[]; code?: string | null; endsInMs?: number | null; repeat?: string } = {}) {
  const t = randomUUID(), tag = t.slice(0, 8);
  await A(`insert into tenants (id, name) values ('${t}', 'OF ${tag}')`);
  await A(`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values ('${t}', 'of-waba-${tag}', '${encryptSecret('T', KEY)}', 'valid', 'ok')`);
  const acc = (await q(`select id from meta_accounts where tenant_id = '${t}'`))[0]!.id;
  await A(`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values ('${t}', '${acc}', 'of-pn-${tag}', '+91 90000 00000')`);
  const offer = o.offer === undefined ? { text: 'Weekend offer!', hasExpiration: true } : o.offer;
  const tpl = (await q(`insert into templates (tenant_id, name, language, category, status, body, category_current, buttons, offer) values ('${t}', 'wk_offer', 'en', 'marketing', 'approved', 'Hi {{1}}, use the code for 20% off this weekend.', 'marketing', '${JSON.stringify(o.buttons ?? BUTTONS)}'::jsonb, ${offer ? `'${JSON.stringify(offer)}'::jsonb` : 'null'}) returning id`))[0]!.id as string;
  const g = (await q(`insert into contact_groups (tenant_id, name) values ('${t}', 'g') returning id`))[0]!.id as string;
  for (const n of ['Asha', 'Ravi']) {
    const c = (await q(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${t}', '+9190${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}', '${n}', 'allowed') returning id`))[0]!.id;
    await A(`insert into contact_group_members (tenant_id, group_id, contact_id) values ('${t}', '${g}', '${c}')`);
  }
  const ends = o.endsInMs === null ? 'null' : `now() + interval '${Math.round((o.endsInMs ?? 3_600_000) / 1000)} seconds'`;
  const code = o.code === null ? 'null' : `'${o.code ?? 'WEEKEND20'}'`;
  const camp = (await q(`insert into campaigns (tenant_id, name, template_id, group_ids, status, scheduled_at, repeat, var_map, offer_code, offer_expires_at) values ('${t}', 'Weekend', '${tpl}', ARRAY['${g}']::uuid[], 'scheduled', now(), '${o.repeat ?? 'none'}', '["@name"]'::jsonb, ${code}, ${ends}) returning id`))[0]!.id as string;
  return { t, tag, camp, tpl };
}
const payloadsOf = async (camp: string) => (await q(`select m.payload from messages m join campaign_recipients r on r.id = m.campaign_recipient_id where r.campaign_id = '${camp}'`)).map((r) => r.payload as { code?: string; offerExpiresMs?: number });

describe('launching an offer campaign', () => {
  it('puts the code and the end time on every message', async () => {
    const s = await setup(); const r = await launchCampaign(db, s.t, s.camp);
    expect(r.status).toBe('running'); const p = await payloadsOf(s.camp); expect(p).toHaveLength(2);
    for (const x of p) { expect(x.code).toBe('WEEKEND20'); expect(x.offerExpiresMs).toBeGreaterThan(Date.now() + 3_000_000); }
  });
  it('refuses to start when the format has a copy-code button but the campaign has no code', async () => {
    const s = await setup({ code: null }); const r = await launchCampaign(db, s.t, s.camp);
    expect(r).toMatchObject({ status: 'paused', reason: 'offer_code_missing', queued: 0 }); expect(await payloadsOf(s.camp)).toHaveLength(0);
  });
  it('refuses to start a countdown with no end time, or one that has already ended or ends in under a minute', async () => {
    for (const [ends, why] of [[null, 'offer_time_missing'], [-60_000, 'offer_ended'], [30_000, 'offer_ended']] as const) {
      const s = await setup({ endsInMs: ends }); const r = await launchCampaign(db, s.t, s.camp);
      expect(r).toMatchObject({ status: 'paused', reason: why }); expect(await payloadsOf(s.camp)).toHaveLength(0);
    }
  });
  it('a plain format is not affected: no code or end time is needed or added', async () => {
    const s = await setup({ offer: null, buttons: [], code: null, endsInMs: null }); expect((await launchCampaign(db, s.t, s.camp)).status).toBe('running');
    for (const x of await payloadsOf(s.camp)) { expect(x.code).toBeUndefined(); expect(x.offerExpiresMs).toBeUndefined(); }
  });
  it('an offer without a countdown needs no end time but still sends its code', async () => {
    const s = await setup({ offer: { text: 'Big sale!', hasExpiration: false }, endsInMs: null }); expect((await launchCampaign(db, s.t, s.camp)).status).toBe('running');
    for (const x of await payloadsOf(s.camp)) { expect(x.code).toBe('WEEKEND20'); expect(x.offerExpiresMs).toBeUndefined(); }
  });
  it('a repeating campaign carries its code and end time into the next run', async () => {
    const s = await setup({ repeat: 'daily' }); await launchCampaign(db, s.t, s.camp);
    const next = (await q(`select offer_code, offer_expires_at from campaigns where tenant_id = '${s.t}' and id <> '${s.camp}'`))[0]!;
    expect(next.offer_code).toBe('WEEKEND20'); expect(next.offer_expires_at).toBeTruthy();
  });
});

describe('sending an offer', () => {
  const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: 'http://127.0.0.1:9', appId: 'A', appSecret: 'S', timeoutMs: 500 });
  it('a message whose countdown ran out while it waited in the queue is skipped, not sent', async () => {
    const s = await setup(); await launchCampaign(db, s.t, s.camp);
    await A(`update messages set payload = jsonb_set(payload, '{offerExpiresMs}', to_jsonb(${Date.now() - 1000}::bigint)) where tenant_id = '${s.t}'`);
    const id = (await q(`select id from messages where tenant_id = '${s.t}' limit 1`))[0]!.id as string;
    const r = await sendOne({ db, graph: graph(), tokenKey: KEY }, s.t, id);
    expect(r).toMatchObject({ kind: 'skipped' }); expect((r as { reason: string }).reason).toMatch(/offer has ended/);
    expect((await q(`select status, wamid from messages where id = '${id}'`))[0]).toMatchObject({ status: 'failed', wamid: null });
  });
  it('builds the offer countdown between the body and the buttons, and the code on the copy button', () => {
    const c = templateComponents({ params: ['Asha'], code: 'WEEKEND20', offerExpiresMs: 1698562800000 }, { header_type: 'none', buttons: BUTTONS, offer: { hasExpiration: true } }, null)!;
    expect(c.map((x) => x.type)).toEqual(['body', 'limited_time_offer', 'button']);
    expect(c[1]).toMatchObject({ parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: 1698562800000 } }] });
    expect(c[2]).toMatchObject({ sub_type: 'copy_code', index: '0', parameters: [{ type: 'coupon_code', coupon_code: 'WEEKEND20' }] });
  });
  it('no countdown parameter when the offer has no expiry; an offer with a countdown but no time is an error, never a silent send', () => {
    expect(templateComponents({ params: ['A'], code: 'X' }, { header_type: 'none', buttons: BUTTONS, offer: { hasExpiration: false } }, null)!.map((x) => x.type)).toEqual(['body', 'button']);
    expect(() => templateComponents({ params: ['A'], code: 'X' }, { header_type: 'none', buttons: BUTTONS, offer: { hasExpiration: true } }, null)).toThrow(/end time/);
  });
});

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '@lbc/db';
import { launchCampaign } from '../src/campaigns';
import { encryptSecret } from '@lbc/meta';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db, A = admin.client.unsafe;
const KEY = randomBytes(32).toString('base64');
afterAll(async () => {
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'AB %')`);
  await A(`delete from tenants where name like 'AB %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});

type Tpl = { name?: string; category?: string; status?: string; body?: string; buttons?: object[]; offer?: object | null };
async function setup(o: { people?: number; pct?: number; b?: Tpl | null; a?: Tpl; aVars?: string[]; bVars?: string[]; stopped?: number } = {}) {
  const t = randomUUID(), tag = t.slice(0, 8);
  await A(`insert into tenants (id, name, quiet_hours_enabled) values ('${t}', 'AB ${tag}', false)`);
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
  const camp = (await A(`insert into campaigns (tenant_id, name, template_id, group_ids, status, scheduled_at, repeat, var_map) values ('${t}', 'AB', '${ta}', ARRAY['${g}']::uuid[], 'scheduled', now() - interval '1 minute', 'none', '${JSON.stringify(o.aVars ?? ['@name'])}'::jsonb) returning id`))[0]!.id as string;
  if (ab) await A(`update campaigns set ${ab.slice(2)} where id = '${camp}'`);
  return { t, camp, ta, tb };
}
const recips = (camp: string) => A(`select r.version, r.state, m.template_name, m.payload from campaign_recipients r left join messages m on m.campaign_recipient_id = r.id where r.campaign_id = '${camp}'`) as unknown as Promise<{ version: string; state: string; template_name: string | null; payload: { params: string[] } }[]>;

describe('A/B launch', () => {
  it('splits exactly as asked, and each person gets only their own version, template and blanks', async () => {
    const s = await setup({ people: 40, pct: 25 }); const r = await launchCampaign(db, s.t, s.camp); expect(r.status).toBe('running'); expect(r.queued).toBe(40);
    const rows = await recips(s.camp);
    expect(rows.filter((x) => x.version === 'b').length).toBe(10); expect(rows.filter((x) => x.version === 'a').length).toBe(30);
    for (const x of rows) {
      if (x.version === 'b') { expect(x.template_name).toBe('ab_b'); expect(x.payload.params).toEqual(['Bee']); }
      else { expect(x.template_name).toBe('ab_a'); expect(x.payload.params).toEqual(['Pat']); }
    }
    expect((await A(`select count(*)::int n from messages m join campaign_recipients r on r.id = m.campaign_recipient_id where r.campaign_id = '${s.camp}'`))[0]!.n).toBe(40);   // one message each, never two
  });

  it('splits the people who will really be messaged: opted-out people do not use up a slot (checked on several campaigns, so luck cannot hide a wrong split)', async () => {
    for (let i = 0; i < 6; i++) {
      const s = await setup({ people: 30, pct: 50, stopped: 20 }); await launchCampaign(db, s.t, s.camp);   // 10 will be messaged, 20 have opted out
      const rows = (await recips(s.camp)).filter((x) => x.state !== 'skipped');
      expect(rows.length).toBe(10); expect(rows.filter((x) => x.version === 'b').length, `campaign ${i}`).toBe(5);
    }
  });

  it('a campaign without a test is unchanged: everyone is version A', async () => {
    const s = await setup({ b: null }); await launchCampaign(db, s.t, s.camp);
    const rows = await recips(s.camp); expect(rows.every((x) => x.version === 'a' && x.template_name === 'ab_a')).toBe(true);
  });

  it('the same campaign launched twice (a retry) never gives anyone a second message or swaps their version', async () => {
    const s = await setup({ people: 20 }); await launchCampaign(db, s.t, s.camp);
    const before = JSON.stringify((await A(`select contact_id, version from campaign_recipients where campaign_id = '${s.camp}' order by contact_id`)));
    await A(`update campaigns set status = 'scheduled' where id = '${s.camp}'`); await launchCampaign(db, s.t, s.camp);
    expect(JSON.stringify(await A(`select contact_id, version from campaign_recipients where campaign_id = '${s.camp}' order by contact_id`))).toBe(before);
    expect((await A(`select count(*)::int n from messages m join campaign_recipients r on r.id = m.campaign_recipient_id where r.campaign_id = '${s.camp}'`))[0]!.n).toBe(20);
  });

  it('pauses, and sends nothing, when version B is not approved', async () => {
    const s = await setup({ b: { status: 'pending', body: 'Hi {{1}}, B.' } }); const r = await launchCampaign(db, s.t, s.camp);
    expect(r).toMatchObject({ status: 'paused', reason: 'ab_template_not_approved' }); expect((await recips(s.camp)).length).toBe(0);
  });

  it('pauses when the two versions are different kinds of message (different category)', async () => {
    const s = await setup({ b: { category: 'utility', body: 'Hi {{1}}, B.' } }); const r = await launchCampaign(db, s.t, s.camp);
    expect(r).toMatchObject({ status: 'paused', reason: 'ab_category_differs' }); expect((await recips(s.camp)).length).toBe(0);
  });

  it('pauses when only one version is an offer with a copy-code button', async () => {
    const s = await setup({ b: { body: 'Hi {{1}}, B.', buttons: [{ type: 'copy_code', value: 'x' }] } }); const r = await launchCampaign(db, s.t, s.camp);
    expect(r).toMatchObject({ status: 'paused', reason: 'ab_offer_differs' }); expect((await recips(s.camp)).length).toBe(0);
  });

  it('the database refuses a broken test setup: same template twice, share out of range, half-filled, or a repeating test', async () => {
    const s = await setup({ people: 2 });
    await A(`update campaigns set ab_template_id = null, ab_var_map = null, ab_percent_b = null where id = '${s.camp}'`);   // start from a plain campaign, so each case below is the only thing being tried
    for (const bad of [`ab_template_id = template_id, ab_var_map = '[]', ab_percent_b = 50`, `ab_template_id = '${s.tb}', ab_var_map = '[]', ab_percent_b = 5`, `ab_template_id = '${s.tb}', ab_var_map = '[]', ab_percent_b = 95`, `ab_template_id = '${s.tb}'`, `ab_percent_b = 50`, `ab_template_id = '${s.tb}', ab_var_map = '{}', ab_percent_b = 50`, `ab_template_id = '${s.tb}', ab_var_map = '[]', ab_percent_b = 50, repeat = 'daily'`])
      await expect(A(`update campaigns set ${bad} where id = '${s.camp}'`), bad).rejects.toThrow();
    expect((await A(`select ab_percent_b from campaigns where id = '${s.camp}'`))[0]!.ab_percent_b).toBeNull();   // none of them stuck
    await A(`update campaigns set ab_template_id = '${s.tb}', ab_var_map = '[]', ab_percent_b = 50 where id = '${s.camp}'`);   // and a correct setup is accepted
  });

  it('a template used by a running A/B test cannot be deleted out from under it', async () => {
    const s = await setup({ people: 2 }); await expect(A(`delete from templates where id = '${s.tb}'`)).rejects.toThrow();
  });
});

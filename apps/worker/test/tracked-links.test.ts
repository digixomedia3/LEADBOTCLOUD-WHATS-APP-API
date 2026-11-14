import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '@lbc/db';
import { encryptSecret } from '@lbc/meta';
import { launchCampaign } from '../src/campaigns';
import { templateComponents } from '../src/send';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db, A = admin.client.unsafe, KEY = randomBytes(32).toString('base64');
const APP = 'https://panel.example-company.in';
const TRACKED = { type: 'url', text: 'Open', value: `${APP}/r/{{1}}` };
afterAll(async () => {
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'TL %')`);
  await A(`delete from tenants where name like 'TL %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});

async function setup(o: { buttons?: object[]; linkUrl?: string | null; people?: number } = {}) {
  const t = randomUUID(), tag = t.slice(0, 8);
  await A(`insert into tenants (id, name) values ('${t}', 'TL ${tag}')`);
  await A(`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values ('${t}', 'tl-waba-${tag}', '${encryptSecret('T', KEY)}', 'valid', 'ok')`);
  const acc = (await A(`select id from meta_accounts where tenant_id = '${t}'`))[0]!.id;
  await A(`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values ('${t}', '${acc}', 'tl-pn-${tag}', '+91 90000 00000')`);
  const tpl = (await A(`insert into templates (tenant_id, name, language, category, status, body, category_current, buttons) values ('${t}', 'tl_t', 'en', 'marketing', 'approved', 'Hello {{1}}, look at our new range today.', 'marketing', '${JSON.stringify(o.buttons ?? [TRACKED])}'::jsonb) returning id`))[0]!.id as string;
  const g = (await A(`insert into contact_groups (tenant_id, name) values ('${t}', 'g') returning id`))[0]!.id as string;
  for (let i = 0; i < (o.people ?? 3); i++) {
    const c = (await A(`insert into contacts (tenant_id, phone_e164, name, consent_status) values ('${t}', '+9190${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}', 'P${i}', 'allowed') returning id`))[0]!.id;
    await A(`insert into contact_group_members (tenant_id, group_id, contact_id) values ('${t}', '${g}', '${c}')`);
  }
  const link = o.linkUrl === undefined ? 'https://shop.example.com/offer' : o.linkUrl;
  const camp = (await A(`insert into campaigns (tenant_id, name, template_id, group_ids, status, scheduled_at, repeat, var_map, link_url) values ('${t}', 'TL', '${tpl}', ARRAY['${g}']::uuid[], 'scheduled', now() - interval '1 minute', 'none', '["@name"]'::jsonb, ${link ? `'${link}'` : 'null'}) returning id`))[0]!.id as string;
  return { t, camp };
}
const codes = async (camp: string) => (await A(`select l.code, l.campaign_recipient_id, m.payload->>'linkCode' as in_msg from tracked_links l join messages m on m.campaign_recipient_id = l.campaign_recipient_id where l.campaign_id = '${camp}'`)) as unknown as { code: string; campaign_recipient_id: string; in_msg: string }[];

describe('launching a campaign with a tracked link', () => {
  it('gives every person their own code, stored and put on their message', async () => {
    const s = await setup({ people: 4 }); const r = await launchCampaign(db, s.t, s.camp, APP);
    expect(r.status).toBe('running');
    const c = await codes(s.camp);
    expect(c).toHaveLength(4); expect(new Set(c.map((x) => x.code)).size).toBe(4);
    for (const x of c) { expect(x.code).toMatch(/^[A-Za-z0-9]{12}$/); expect(x.in_msg).toBe(x.code); }
  });
  it('a plain website button (not ours) gets no codes and needs no destination', async () => {
    const s = await setup({ buttons: [{ type: 'url', text: 'Shop', value: 'https://shop.example.com/{{1}}' }], linkUrl: null });
    expect((await launchCampaign(db, s.t, s.camp, APP)).status).toBe('running');
    expect(await codes(s.camp)).toHaveLength(0);
    expect(Number((await A(`select count(*)::int n from messages where tenant_id = '${s.t}' and payload ? 'linkCode'`))[0]!.n)).toBe(0);
  });
  it('a campaign without the tracked button never creates codes even if a link was stored', async () => {
    const s = await setup({ buttons: [], linkUrl: 'https://shop.example.com/offer' });
    expect((await launchCampaign(db, s.t, s.camp, APP)).status).toBe('running'); expect(await codes(s.camp)).toHaveLength(0);
  });
  it('pauses, sending nothing, when the destination is missing', async () => {
    const s = await setup({ linkUrl: null }); const r = await launchCampaign(db, s.t, s.camp, APP);
    expect(r).toMatchObject({ status: 'paused', reason: 'link_missing', queued: 0 });
    expect(await codes(s.camp)).toHaveLength(0); expect(Number((await A(`select count(*)::int n from messages where tenant_id = '${s.t}'`))[0]!.n)).toBe(0);
  });
  it('pauses, sending nothing, when the app address is only temporary (the link would die)', async () => {
    for (const bad of ['https://abc-def.trycloudflare.com', 'http://localhost:3000', 'https://x.ngrok-free.app']) {
      const s = await setup({ buttons: [{ type: 'url', text: 'Open', value: `${bad}/r/{{1}}` }] });
      const r = await launchCampaign(db, s.t, s.camp, bad);
      expect(r, bad).toMatchObject({ status: 'paused', reason: 'app_url_temporary', queued: 0 }); expect(await codes(s.camp)).toHaveLength(0);
    }
  });
  it('the temporary-address check can be relaxed for local development only', async () => {
    const dev = 'http://localhost:3000'; const s = await setup({ buttons: [{ type: 'url', text: 'Open', value: `${dev}/r/{{1}}` }] });
    expect((await launchCampaign(db, s.t, s.camp, dev, false)).status).toBe('running'); expect(await codes(s.camp)).toHaveLength(3);
  });
  it('a worker that does not know the app address treats the button as an ordinary one and never invents codes', async () => {
    const s = await setup(); await launchCampaign(db, s.t, s.camp, undefined);
    expect(await codes(s.camp)).toHaveLength(0);
  });
  it('a repeating campaign keeps its destination for the next run', async () => {
    const s = await setup(); await A(`update campaigns set repeat = 'weekly' where id = '${s.camp}'`);
    await launchCampaign(db, s.t, s.camp, APP);
    const next = (await A(`select link_url from campaigns where tenant_id = '${s.t}' and id <> '${s.camp}'`))[0]!;
    expect(next.link_url).toBe('https://shop.example.com/offer');
  });
  it('launching the same campaign twice does not hand out a second set of codes', async () => {
    const s = await setup(); await launchCampaign(db, s.t, s.camp, APP); await launchCampaign(db, s.t, s.camp, APP);
    expect(await codes(s.camp)).toHaveLength(3);
  });
  it('another workspace cannot see these codes', async () => {
    const a = await setup(), b = await setup(); await launchCampaign(db, a.t, a.camp, APP);
    expect(Number((await A(`select count(*)::int n from tracked_links where tenant_id = '${b.t}'`))[0]!.n)).toBe(0);
  });
});

describe('the button on the outgoing message', () => {
  const tpl = { header_type: 'none', buttons: [{ type: 'quick_reply', text: 'Hi' }, TRACKED] };
  it('fills the website button with this person\'s code at the right position', () => {
    const c = templateComponents({ params: ['Asha'], linkCode: 'AbCdEfGhIjKl' }, tpl, null, APP) as { type: string; sub_type?: string; index?: string; parameters: { text?: string }[] }[];
    const b = c.find((x) => x.type === 'button')!;
    expect(b).toMatchObject({ sub_type: 'url', index: '1' }); expect(b.parameters).toEqual([{ type: 'text', text: 'AbCdEfGhIjKl' }]);
  });
  it('refuses to send without the code rather than send a broken link', () => {
    expect(() => templateComponents({ params: ['Asha'] }, tpl, null, APP)).toThrow(/no link code/);
  });
  it('never fills a customer\'s own dynamic link, or anything when the app address is unknown', () => {
    const own = { header_type: 'none', buttons: [{ type: 'url', text: 'Shop', value: 'https://shop.example.com/{{1}}' }] };
    expect(templateComponents({ linkCode: 'AbCdEfGhIjKl' }, own, null, APP)).toBeUndefined();
    expect(templateComponents({ linkCode: 'AbCdEfGhIjKl' }, tpl, null, undefined)).toBeUndefined();
    expect(templateComponents({ linkCode: 'AbCdEfGhIjKl' }, { header_type: 'none', buttons: [{ type: 'url', text: 'x', value: `${APP}.evil.com/r/{{1}}` }] }, null, APP)).toBeUndefined();
  });
});

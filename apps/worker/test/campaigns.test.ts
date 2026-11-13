import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { encryptSecret } from '@lbc/meta';
import { dueCampaigns, launchCampaign, queuedMessageIds, resolveVar, rollupCampaigns } from '../src/campaigns';

const src = (await import('node:fs')).readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db;
const KEY = randomBytes(32).toString('base64');
afterAll(async () => {
  await admin.client.unsafe(`delete from audit_log where tenant_id in (select id from tenants where name like 'LC %')`);
  await admin.client.unsafe(`delete from tenants where name like 'LC %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
const q = async <T = any>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];

async function setup(o: { category?: string; tokenStatus?: string; templateStatus?: string; repeat?: string; cap?: number | null; varMap?: string[]; people?: { name: string | null; consent: string; reach?: string; hold?: boolean }[] } = {}) {
  const tenant = randomUUID(), tag = tenant.slice(0, 8);
  await admin.client.unsafe(`insert into tenants (id, name) values ('${tenant}', 'LC ${tag}')`);
  await db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${'lc-waba-' + tag}, ${encryptSecret('T', KEY)}, ${o.tokenStatus ?? 'valid'}, 'ok')`);
  const acc = (await q<{ id: string }>(sql`select id from meta_accounts where tenant_id = ${tenant}`))[0]!;
  await db.execute(sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${tenant}, ${acc.id}, ${'lc-pn-' + tag}, '+91 90000 00000')`);
  const tpl = (await q<{ id: string }>(sql`insert into templates (tenant_id, name, language, category, status, body, category_current) values (${tenant}, 'offer', 'en', ${o.category ?? 'marketing'}, ${o.templateStatus ?? 'approved'}, 'Hi {{1}}, offer {{2}}', ${o.category ?? 'marketing'}) returning id`))[0]!;
  const grp = (await q<{ id: string }>(sql`insert into contact_groups (tenant_id, name) values (${tenant}, 'g') returning id`))[0]!;
  const people = o.people ?? [{ name: 'Asha Verma', consent: 'allowed' }, { name: null, consent: 'allowed' }, { name: 'Ravi', consent: 'stopped' }, { name: 'Meena', consent: 'unknown' }];
  let i = 0;
  for (const p of people) {
    const c = (await q<{ id: string }>(sql`insert into contacts (tenant_id, phone_e164, name, consent_status, reachability, freq_cap_hold_until) values (${tenant}, ${'+9190' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}, ${p.name}, ${p.consent}, ${p.reach ?? 'ok'}, ${p.hold ? new Date(Date.now() + 3600_000).toISOString() : null}::timestamptz) returning id`))[0]!;
    await db.execute(sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${tenant}, ${grp.id}, ${c.id})`);
    i++;
  }
  const camp = (await q<{ id: string }>(sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, scheduled_at, repeat, spend_cap_paise, var_map) values (${tenant}, 'Diwali', ${tpl.id}, ARRAY[${grp.id}]::uuid[], 'scheduled', now() - interval '1 minute', ${o.repeat ?? 'none'}, ${o.cap ?? null}, ${JSON.stringify(o.varMap ?? ['@name', '20% off'])}::jsonb) returning id`))[0]!;
  return { tenant, camp: camp.id, tpl: tpl.id };
}

describe('resolveVar', () => {
  it('first name, full name, phone, fixed text, and a safe fallback', () => {
    expect(resolveVar('@name', { name: 'Asha Verma', phone: '+91' })).toBe('Asha');
    expect(resolveVar('@name', { name: null, phone: '+91' })).toBe('there');
    expect(resolveVar('@name', { name: '   ', phone: '+91' })).toBe('there');
    expect(resolveVar('@fullname', { name: 'Asha Verma', phone: '+91' })).toBe('Asha Verma');
    expect(resolveVar('@phone', { name: null, phone: '+919800000001' })).toBe('+919800000001');
    expect(resolveVar('20% off', { name: 'A', phone: '+91' })).toBe('20% off');
  });
});

describe('launchCampaign', () => {
  it('queues one message per allowed contact with personalised params; skips opted-out and no-permission contacts with reasons', async () => {
    const s = await setup();
    const r = await launchCampaign(db, s.tenant, s.camp);
    expect(r).toMatchObject({ status: 'running', queued: 2, skipped: 2 });
    const msgs = await q(sql`select payload, status, template_name, template_category, campaign_recipient_id from messages where tenant_id = ${s.tenant} order by (payload->'params'->>0)`);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.payload.params)).toEqual([['Asha', '20% off'], ['there', '20% off']]);
    expect(msgs.every((m) => m.status === 'queued' && m.template_name === 'offer' && m.template_category === 'marketing' && m.campaign_recipient_id)).toBe(true);
    const skipped = await q(sql`select reason from campaign_recipients where campaign_id = ${s.camp} and state = 'skipped' order by reason`);
    expect(skipped.map((x) => x.reason)).toEqual(['No permission on record', 'Opted out']);
    expect((await q(sql`select counts from campaigns where id = ${s.camp}`))[0].counts).toMatchObject({ audience: 2, skipped: 2, optedOut: 1 });
  });
  it('is exactly-once: a second launch (even concurrent) creates nothing', async () => {
    const s = await setup();
    const rs = await Promise.all([launchCampaign(db, s.tenant, s.camp), launchCampaign(db, s.tenant, s.camp), launchCampaign(db, s.tenant, s.camp)]);
    expect(rs.filter((r) => r.status === 'running')).toHaveLength(1);
    expect((await q(sql`select count(*)::int n from messages where tenant_id = ${s.tenant}`))[0].n).toBe(2);
  });
  it('utility messages go to contacts without marketing permission but never to opted-out contacts', async () => {
    const s = await setup({ category: 'utility' });
    expect(await launchCampaign(db, s.tenant, s.camp)).toMatchObject({ queued: 3, skipped: 1 });
  });
  it('skips unreachable contacts and those on a 24h Meta hold', async () => {
    const s = await setup({ people: [{ name: 'A', consent: 'allowed' }, { name: 'B', consent: 'allowed', reach: 'unreachable' }, { name: 'C', consent: 'allowed', hold: true }] });
    expect(await launchCampaign(db, s.tenant, s.camp)).toMatchObject({ queued: 1, skipped: 2 });
  });
  it('pauses (queues nothing) when the token expired, the template is not approved, or the cap is exceeded', async () => {
    let s = await setup({ tokenStatus: 'invalid' });
    expect(await launchCampaign(db, s.tenant, s.camp)).toMatchObject({ status: 'paused', reason: 'reconnect', queued: 0 });
    s = await setup({ templateStatus: 'paused' });
    expect(await launchCampaign(db, s.tenant, s.camp)).toMatchObject({ status: 'paused', reason: 'template_not_approved' });
    s = await setup({ cap: 100 }); // ₹1.00 cap, 2 people cost about ₹2.04
    expect(await launchCampaign(db, s.tenant, s.camp)).toMatchObject({ status: 'paused', reason: 'spend_cap' });
    expect((await q(sql`select count(*)::int n from messages where tenant_id = ${s.tenant}`))[0].n).toBe(0);
  });
  it('creates the next run for a repeating campaign, scheduled from the original time', async () => {
    const s = await setup({ repeat: 'weekly' });
    await launchCampaign(db, s.tenant, s.camp);
    const next = await q(sql`select status, scheduled_at, (select scheduled_at from campaigns where id = ${s.camp}) orig from campaigns where tenant_id = ${s.tenant} and id <> ${s.camp}`);
    expect(next).toHaveLength(1); expect(next[0].status).toBe('scheduled');
    expect(Math.round((new Date(next[0].scheduled_at).getTime() - new Date(next[0].orig).getTime()) / 86_400_000)).toBe(7);
  });
  it('one tenant never launches or sees another tenant\'s campaign', async () => {
    const a = await setup(), b = await setup();
    expect((await launchCampaign(db, b.tenant, a.camp)).status).toBe('not_due');
    expect(await queuedMessageIds(db, b.tenant, a.camp)).toHaveLength(0);
  });
  it('due list contains due campaigns only', async () => {
    const s = await setup();
    await db.execute(sql`insert into campaigns (tenant_id, name, template_id, status, scheduled_at) values (${s.tenant}, 'later', ${s.tpl}, 'scheduled', now() + interval '2 days')`);
    const due = (await dueCampaigns(db, 500)).filter((d) => d.tenant_id === s.tenant);
    expect(due).toHaveLength(1);
  });
});

describe('rollupCampaigns', () => {
  it('derives counts from recipients, completes the campaign when nothing is waiting, and never double counts', async () => {
    const s = await setup();
    await launchCampaign(db, s.tenant, s.camp);
    const rec = await q<{ id: string }>(sql`select id from campaign_recipients where campaign_id = ${s.camp} and state = 'queued' order by id`);
    await rollupCampaigns(db);
    expect((await q(sql`select status from campaigns where id = ${s.camp}`))[0].status).toBe('running'); // still waiting
    await db.execute(sql`update campaign_recipients set state = 'read' where id = ${rec[0]!.id}`);
    await db.execute(sql`update campaign_recipients set state = 'capped' where id = ${rec[1]!.id}`);
    await rollupCampaigns(db); await rollupCampaigns(db);
    const c = (await q(sql`select status, counts from campaigns where id = ${s.camp}`))[0];
    expect(c.status).toBe('completed');
    expect(c.counts).toMatchObject({ audience: 2, sent: 1, delivered: 1, read: 1, capped: 1, skipped: 2, failed: 0 });
  });
});

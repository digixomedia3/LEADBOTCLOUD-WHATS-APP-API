import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { GoogleClient, MetaLeadsClient } from '@lbc/connectors';
import { decryptSecret, encryptSecret } from '@lbc/meta';
import { ingestMetaLeadgen, ingestShopify, pendingConnectorEvents, processConnectorEvent, syncSheets } from '../src/connectors';

const src = (await import('node:fs')).readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 4 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db;
const A = admin.client.unsafe;
const tag = randomUUID().slice(0, 8);
const KEY = randomBytes(32).toString('base64');
const SECRET = 'shpss_test_secret';

afterAll(async () => {
  await A(`delete from connector_events where dedupe_key like '%${tag}%' or external_id like '%${tag}%'`);
  await A(`delete from audit_log where tenant_id in (select id from tenants where name like 'CN ${tag}%')`);
  await A(`delete from tenants where name like 'CN ${tag}%'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});

let n = 0;
async function tenantWith(provider: 'shopify' | 'meta_lead_ads' | 'google_sheets', external: string, o: { config?: object; enabled?: boolean; mode?: string; access?: string; refresh?: string | null; expires?: string | null } = {}) {
  const t = randomUUID(), i = ++n;
  await A(`insert into tenants (id, name, plan_id) values ('${t}', 'CN ${tag} ${i}', 'growth')`);
  const s = (await A(`insert into lead_sources (tenant_id, kind, name, public_id, secret_hash, consent_mode, default_tags, enabled) values ('${t}', '${provider}', 'Src ${i}', 'conn_${tag}${i}', null, '${o.mode ?? 'none'}', ARRAY['${provider}'], ${o.enabled ?? true}) returning id`))[0]!.id as string;
  const acc = encryptSecret(o.access ?? 'ACCESS-' + i, KEY), ref = o.refresh === null ? 'null' : `'${encryptSecret(o.refresh ?? 'REFRESH-' + i, KEY)}'`;
  const c = (await A(`insert into connections (tenant_id, provider, external_id, label, access_token_enc, refresh_token_enc, token_expires_at, config, source_id) values ('${t}', '${provider}', '${external}', 'Conn ${i}', '${acc}', ${ref}, ${o.expires ? `'${o.expires}'` : 'null'}, '${JSON.stringify(o.config ?? {}).replace(/'/g, "''")}'::jsonb, '${s}') returning id`))[0]!.id as string;
  return { t, s, c };
}
const q = async (text: string) => A(text);
const leadsOf = (t: string) => q(`select l.id, c.phone_e164, c.name, c.consent_status, l.fields from leads l join contacts c on c.id = l.contact_id where l.tenant_id = '${t}' order by l.created_at`);
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('base64');
const hdrs = (body: string, shop: string, topic: string, id: string, secret = SECRET) => ({ 'x-shopify-hmac-sha256': sign(body, secret), 'x-shopify-shop-domain': shop, 'x-shopify-topic': topic, 'x-shopify-event-id': id });

describe('Shopify webhooks', () => {
  const customer = { id: 9001, first_name: 'Asha', last_name: 'Verma', phone: '+919876500101', email: 'a@x.in', accepts_marketing: true, email_marketing_consent: { state: 'subscribed' }, default_address: { city: 'Pune' } };
  it('a signed customer event becomes a lead; Shopify marketing opt-in is NOT WhatsApp consent', async () => {
    const shop = `s1-${tag}.myshopify.com`; const { t } = await tenantWith('shopify', shop, { mode: 'field' });
    const body = JSON.stringify(customer); const r = await ingestShopify(db, Buffer.from(body), hdrs(body, shop, 'customers/create', `e1-${tag}`), SECRET);
    expect(r.status).toBe(200); expect(r.ids).toHaveLength(1);
    expect(await processConnectorEvent({ db, tokenKey: KEY }, r.ids[0]!)).toBe('done');
    const l = await leadsOf(t); expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ phone_e164: '+919876500101', name: 'Asha Verma', consent_status: 'unknown' });
    expect((await q(`select processed_at is not null as p, process_error from connector_events where id = ${r.ids[0]}`))[0]).toMatchObject({ p: true, process_error: null });
  });
  it('a wrong signature is recorded but never processed, and creates nothing', async () => {
    const shop = `s2-${tag}.myshopify.com`; const { t } = await tenantWith('shopify', shop);
    const body = JSON.stringify(customer);
    const r = await ingestShopify(db, Buffer.from(body), hdrs(body, shop, 'customers/create', `e2-${tag}`, 'wrong-secret'), SECRET);
    expect(r).toEqual({ status: 401, ids: [] }); expect(await leadsOf(t)).toHaveLength(0);
    expect((await q(`select count(*)::int as n from connector_events where signature_ok = false and payload->>'note' = 'signature mismatch' and received_at > now() - interval '1 minute'`))[0]!.n).toBeGreaterThan(0);
    expect(await pendingConnectorEvents(db, 500)).not.toContain(0);
  });
  it('a body edited after signing is rejected; a missing secret means “not configured”', async () => {
    const shop = `s3-${tag}.myshopify.com`; await tenantWith('shopify', shop);
    const body = JSON.stringify(customer); const h = hdrs(body, shop, 'customers/create', `e3-${tag}`);
    expect((await ingestShopify(db, Buffer.from(body.replace('Asha', 'Evil')), h, SECRET)).status).toBe(401);
    expect((await ingestShopify(db, Buffer.from(body), h, undefined)).status).toBe(503);
  });
  it('Shopify retries (same event id) are stored once and make one lead', async () => {
    const shop = `s4-${tag}.myshopify.com`; const { t } = await tenantWith('shopify', shop);
    const body = JSON.stringify({ ...customer, id: 9002, phone: '+919876500102' });
    const a = await ingestShopify(db, Buffer.from(body), hdrs(body, shop, 'customers/create', `e4-${tag}`), SECRET);
    const b = await ingestShopify(db, Buffer.from(body), hdrs(body, shop, 'customers/create', `e4-${tag}`), SECRET);
    expect(a.ids).toHaveLength(1); expect(b.ids).toHaveLength(0); expect(b.status).toBe(200);
    await processConnectorEvent({ db, tokenKey: KEY }, a.ids[0]!); expect(await leadsOf(t)).toHaveLength(1);
  });
  it('the same event processed twice (two workers) is claimed once', async () => {
    const shop = `s5-${tag}.myshopify.com`; const { t } = await tenantWith('shopify', shop);
    const body = JSON.stringify({ ...customer, id: 9003, phone: '+919876500103' });
    const r = await ingestShopify(db, Buffer.from(body), hdrs(body, shop, 'customers/create', `e5-${tag}`), SECRET);
    const out = await Promise.all([1, 2, 3, 4].map(() => processConnectorEvent({ db, tokenKey: KEY }, r.ids[0]!)));
    expect(out.filter((x) => x === 'done')).toHaveLength(1); expect(await leadsOf(t)).toHaveLength(1);
  });
  it('an order creates a lead with the order details; a store nobody connected creates nothing', async () => {
    const shop = `s6-${tag}.myshopify.com`; const { t } = await tenantWith('shopify', shop);
    const order = JSON.stringify({ id: 77, name: '#1001', total_price: '499.00', currency: 'INR', customer: { first_name: 'Ravi', last_name: 'K' }, shipping_address: { phone: '9876500104', city: 'Agra' } });
    const r = await ingestShopify(db, Buffer.from(order), hdrs(order, shop, 'orders/create', `e6-${tag}`), SECRET);
    await processConnectorEvent({ db, tokenKey: KEY }, r.ids[0]!);
    const l = await leadsOf(t); expect(l[0]).toMatchObject({ phone_e164: '+919876500104', name: 'Ravi K' }); expect(l[0]!.fields).toMatchObject({ order_number: '#1001', order_total: '499.00' });
    const ghost = `ghost-${tag}.myshopify.com`; const g = await ingestShopify(db, Buffer.from(order), hdrs(order, ghost, 'orders/create', `e7-${tag}`), SECRET);
    await processConnectorEvent({ db, tokenKey: KEY }, g.ids[0]!);
    expect((await q(`select process_error from connector_events where id = ${g.ids[0]}`))[0]!.process_error).toBe('no_connection');
  });
  it('events for one store land only in that store’s workspace', async () => {
    const a = await tenantWith('shopify', `ta-${tag}.myshopify.com`), b = await tenantWith('shopify', `tb-${tag}.myshopify.com`);
    const body = JSON.stringify({ ...customer, id: 9010, phone: '+919876500110' });
    const r = await ingestShopify(db, Buffer.from(body), hdrs(body, `ta-${tag}.myshopify.com`, 'customers/create', `e8-${tag}`), SECRET);
    await processConnectorEvent({ db, tokenKey: KEY }, r.ids[0]!);
    expect(await leadsOf(a.t)).toHaveLength(1); expect(await leadsOf(b.t)).toHaveLength(0);
  });
  it('a switched-off source ignores events', async () => {
    const shop = `s9-${tag}.myshopify.com`; const { t } = await tenantWith('shopify', shop, { enabled: false });
    const body = JSON.stringify({ ...customer, id: 9011, phone: '+919876500111' });
    const r = await ingestShopify(db, Buffer.from(body), hdrs(body, shop, 'customers/create', `e9-${tag}`), SECRET);
    await processConnectorEvent({ db, tokenKey: KEY }, r.ids[0]!); expect(await leadsOf(t)).toHaveLength(0);
  });
  it('app/uninstalled wipes the tokens, flags the connection and switches the source off', async () => {
    const shop = `s10-${tag}.myshopify.com`; const { s, c } = await tenantWith('shopify', shop);
    const body = JSON.stringify({ id: 1, name: 'Shop' }); const r = await ingestShopify(db, Buffer.from(body), hdrs(body, shop, 'app/uninstalled', `e10-${tag}`), SECRET);
    await processConnectorEvent({ db, tokenKey: KEY }, r.ids[0]!);
    expect((await q(`select status, access_token_enc, refresh_token_enc from connections where id = '${c}'`))[0]).toMatchObject({ status: 'needs_reauth', access_token_enc: null, refresh_token_enc: null });
    expect((await q(`select enabled from lead_sources where id = '${s}'`))[0]!.enabled).toBe(false);
  });
});

/* ----------------------------------------------------------------------------------------------------------------------------------- Facebook */
function fakeMeta(handler: (url: URL) => { status?: number; body: unknown }) {
  const calls: URL[] = [];
  const fetchImpl = (async (u: string) => { const url = new URL(String(u)); calls.push(url); const r = handler(url); return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); }) as unknown as typeof fetch;
  return { calls, meta: new MetaLeadsClient({ appId: 'APP', appSecret: 'SEC', graphVersion: 'v26.0', baseUrl: 'https://g.test', fetchImpl }) };
}
const leadgen = (page: string, id: string) => ({ object: 'page', entry: [{ id: page, time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: page, form_id: 'F1', ad_id: 'AD1', created_time: 1 } }] }] });
const fbLead = (id: string, phone: string) => ({ id, ad_id: 'AD1', form_id: 'F1', is_organic: false, created_time: '2026-11-13T00:00:00+0000', field_data: [{ name: 'full_name', values: ['Meena Rao'] }, { name: 'phone_number', values: [phone] }, { name: 'email', values: ['m@x.in'] }] });

describe('Facebook Lead Ads', () => {
  it('fetches the lead with the Page’s own decrypted token and creates a lead with ad attribution', async () => {
    const page = `pg1-${tag}`; const { t } = await tenantWith('meta_lead_ads', page, { access: 'PAGE-TOKEN-1' });
    const ids = await ingestMetaLeadgen(db, leadgen(page, `lg1-${tag}`)); expect(ids).toHaveLength(1);
    const { meta, calls } = fakeMeta(() => ({ body: fbLead(`lg1-${tag}`, '+919876500201') }));
    expect(await processConnectorEvent({ db, tokenKey: KEY, meta }, ids[0]!)).toBe('done');
    expect(calls[0]!.searchParams.get('access_token')).toBe('PAGE-TOKEN-1');
    const l = await leadsOf(t); expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ phone_e164: '+919876500201', name: 'Meena Rao', consent_status: 'unknown' });
  });
  it('the same leadgen id delivered twice is one event and one lead', async () => {
    const page = `pg2-${tag}`; const { t } = await tenantWith('meta_lead_ads', page);
    const a = await ingestMetaLeadgen(db, leadgen(page, `lg2-${tag}`)), b = await ingestMetaLeadgen(db, leadgen(page, `lg2-${tag}`));
    expect(a).toHaveLength(1); expect(b).toHaveLength(0);
    const { meta } = fakeMeta(() => ({ body: fbLead(`lg2-${tag}`, '+919876500202') })); await processConnectorEvent({ db, tokenKey: KEY, meta }, a[0]!); expect(await leadsOf(t)).toHaveLength(1);
  });
  it('an expired Page token marks the connection for re-connection, and the event is not retried forever', async () => {
    const page = `pg3-${tag}`; const { c } = await tenantWith('meta_lead_ads', page);
    const ids = await ingestMetaLeadgen(db, leadgen(page, `lg3-${tag}`));
    const { meta } = fakeMeta(() => ({ status: 400, body: { error: { message: 'Error validating access token: Session has expired', code: 190 } } }));
    expect(await processConnectorEvent({ db, tokenKey: KEY, meta }, ids[0]!)).toBe('done');
    expect((await q(`select status, last_error from connections where id = '${c}'`))[0]).toMatchObject({ status: 'needs_reauth' });
    expect((await q(`select process_error from connector_events where id = ${ids[0]}`))[0]!.process_error).toBe('needs_reauth');
  });
  it('a temporary Facebook outage is retried later and finally given up on, with the reason kept', async () => {
    const page = `pg4-${tag}`; const { t } = await tenantWith('meta_lead_ads', page);
    const ids = await ingestMetaLeadgen(db, leadgen(page, `lg4-${tag}`));
    const down = fakeMeta(() => ({ status: 503, body: { error: { message: 'Service unavailable' } } }));
    for (let i = 1; i < 6; i++) { expect(await processConnectorEvent({ db, tokenKey: KEY, meta: down.meta }, ids[0]!)).toBe('retry'); expect((await q(`select processed_at from connector_events where id = ${ids[0]}`))[0]!.processed_at).toBeNull(); }
    expect(await processConnectorEvent({ db, tokenKey: KEY, meta: down.meta }, ids[0]!)).toBe('done');
    expect((await q(`select processed_at is not null as p, process_error from connector_events where id = ${ids[0]}`))[0]).toMatchObject({ p: true }); expect(await leadsOf(t)).toHaveLength(0);
  });
  it('a retry that succeeds creates the lead exactly once', async () => {
    const page = `pg5-${tag}`; const { t } = await tenantWith('meta_lead_ads', page);
    const ids = await ingestMetaLeadgen(db, leadgen(page, `lg5-${tag}`));
    expect(await processConnectorEvent({ db, tokenKey: KEY, meta: fakeMeta(() => ({ status: 500, body: { error: { message: 'x' } } })).meta }, ids[0]!)).toBe('retry');
    expect(await processConnectorEvent({ db, tokenKey: KEY, meta: fakeMeta(() => ({ body: fbLead(`lg5-${tag}`, '+919876500205') })).meta }, ids[0]!)).toBe('done');
    expect(await leadsOf(t)).toHaveLength(1);
  });
  it('a Page nobody connected, or a connection that needs re-connecting, creates nothing', async () => {
    const ids = await ingestMetaLeadgen(db, leadgen(`nopage-${tag}`, `lg6-${tag}`)); const { meta, calls } = fakeMeta(() => ({ body: fbLead('x', '+919876500206') }));
    await processConnectorEvent({ db, tokenKey: KEY, meta }, ids[0]!); expect((await q(`select process_error from connector_events where id = ${ids[0]}`))[0]!.process_error).toBe('no_connection');
    const page = `pg7-${tag}`; const { t, c } = await tenantWith('meta_lead_ads', page); await A(`update connections set status = 'needs_reauth' where id = '${c}'`);
    const i2 = await ingestMetaLeadgen(db, leadgen(page, `lg7-${tag}`)); await processConnectorEvent({ db, tokenKey: KEY, meta }, i2[0]!);
    expect(await leadsOf(t)).toHaveLength(0); expect(calls).toHaveLength(0);
  });
  it('without the Facebook app configured the event waits instead of being lost', async () => {
    const page = `pg8-${tag}`; await tenantWith('meta_lead_ads', page);
    const ids = await ingestMetaLeadgen(db, leadgen(page, `lg8-${tag}`));
    expect(await processConnectorEvent({ db, tokenKey: KEY }, ids[0]!)).toBe('retry'); expect((await q(`select processed_at from connector_events where id = ${ids[0]}`))[0]!.processed_at).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------ Sheets */
function fakeGoogle(sheet: string[][], opts: { refreshFails?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (u: string, init?: RequestInit) => {
    calls.push(String(u));
    if (String(u).includes('/token')) return opts.refreshFails ? new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 }) : new Response(JSON.stringify({ access_token: 'NEW-ACCESS', expires_in: 3599 }), { status: 200 });
    const m = decodeURIComponent(String(u)).match(/values\/[^!]+!(\d+):(\d+)?/);
    const from = Number(m![1]), to = m![2] ? Number(m![2]) : from;
    void init;
    return new Response(JSON.stringify({ values: sheet.slice(from - 1, to) }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, google: new GoogleClient({ clientId: 'G', clientSecret: 'S', fetchImpl, tokenUrl: 'https://t.test/token', sheetsBase: 'https://s.test' }) };
}
const HEAD = ['Name', 'Phone', 'City'];

describe('Google Sheets sync', () => {
  it('reads new rows using the header, remembers where it stopped, and does not repeat them', async () => {
    const { t, c } = await tenantWith('google_sheets', `gs1-${tag}`, { config: { spreadsheetId: `SID1${tag}`, sheet: 'Leads' }, expires: '2099-01-01T00:00:00Z' });
    const sheet = [HEAD, ['Asha', '98765 00301', 'Lucknow'], ['Ravi', '+919876500302', 'Agra']];
    const { google } = fakeGoogle(sheet);
    const r1 = await syncSheets({ db, tokenKey: KEY, google }); expect(r1.errors).toBe(0);
    let l = await leadsOf(t); expect(l.map((x) => x.phone_e164)).toEqual(['+919876500301', '+919876500302']); expect(l[0]!.fields).toMatchObject({ city: 'Lucknow' });
    expect((await q(`select (config->>'nextRow')::int as n from connections where id = '${c}'`))[0]!.n).toBe(4);
    await syncSheets({ db, tokenKey: KEY, google }); expect(await leadsOf(t)).toHaveLength(2);
    sheet.push(['Meena', '9876500303', 'Pune']); await syncSheets({ db, tokenKey: KEY, google });
    expect((await leadsOf(t)).map((x) => x.name)).toEqual(['Asha', 'Ravi', 'Meena']);
  });
  it('if the bookmark is lost, re-reading the whole sheet creates no duplicates', async () => {
    const { t, c } = await tenantWith('google_sheets', `gs2-${tag}`, { config: { spreadsheetId: `SID2${tag}` }, expires: '2099-01-01T00:00:00Z' });
    const { google } = fakeGoogle([HEAD, ['Asha', '9876500311', 'X'], ['Ravi', '9876500312', 'Y']]);
    await syncSheets({ db, tokenKey: KEY, google }); await A(`update connections set config = '{"spreadsheetId":"SID2${tag}"}'::jsonb where id = '${c}'`);
    await syncSheets({ db, tokenKey: KEY, google }); expect(await leadsOf(t)).toHaveLength(2);
  });
  it('skips blank rows, rows without a valid phone are rejected visibly, and the bookmark still moves past them', async () => {
    const { t, s, c } = await tenantWith('google_sheets', `gs3-${tag}`, { config: { spreadsheetId: `SID3${tag}` }, expires: '2099-01-01T00:00:00Z' });
    const { google } = fakeGoogle([HEAD, ['', '', ''], ['Bad', 'not a number', 'Z'], ['Good', '9876500321', 'Q']]);
    await syncSheets({ db, tokenKey: KEY, google });
    expect(await leadsOf(t)).toHaveLength(1); expect((await q(`select count(*)::int as n from lead_rejects where source_id = '${s}'`))[0]!.n).toBe(1);
    expect((await q(`select (config->>'nextRow')::int as n from connections where id = '${c}'`))[0]!.n).toBe(5);
  });
  it('an expired access token is refreshed and the new one is stored encrypted', async () => {
    const { c } = await tenantWith('google_sheets', `gs4-${tag}`, { config: { spreadsheetId: `SID4${tag}` }, expires: '2020-01-01T00:00:00Z', access: 'OLD', refresh: 'RT-1' });
    const { google, calls } = fakeGoogle([HEAD]); await syncSheets({ db, tokenKey: KEY, google });
    expect(calls.some((u) => u.includes('/token'))).toBe(true);
    const row = (await q(`select access_token_enc, refresh_token_enc, token_expires_at from connections where id = '${c}'`))[0]!;
    expect(decryptSecret(row.access_token_enc, KEY)).toBe('NEW-ACCESS'); expect(decryptSecret(row.refresh_token_enc, KEY)).toBe('RT-1'); expect(row.access_token_enc).not.toContain('NEW-ACCESS');
    expect(new Date(row.token_expires_at).getTime()).toBeGreaterThan(Date.now());
  });
  it('access removed by the owner flags the connection and stops syncing it', async () => {
    const { c } = await tenantWith('google_sheets', `gs5-${tag}`, { config: { spreadsheetId: `SID5${tag}` }, expires: '2020-01-01T00:00:00Z' });
    const { google } = fakeGoogle([HEAD], { refreshFails: true }); const r = await syncSheets({ db, tokenKey: KEY, google }); expect(r.errors).toBeGreaterThan(0);
    expect((await q(`select status from connections where id = '${c}'`))[0]!.status).toBe('needs_reauth');
    const again = fakeGoogle([HEAD]); await syncSheets({ db, tokenKey: KEY, google: again.google }); expect(again.calls.filter((u) => u.includes(`SID5${tag}`))).toHaveLength(0);
  });
  it('a switched-off source and a connection with no sheet chosen are left alone; a missing Google app does nothing', async () => {
    const off = await tenantWith('google_sheets', `gs6-${tag}`, { config: { spreadsheetId: `SID6${tag}` }, enabled: false, expires: '2099-01-01T00:00:00Z' });
    const none = await tenantWith('google_sheets', `gs7-${tag}`, { config: {}, expires: '2099-01-01T00:00:00Z' });
    const { google, calls } = fakeGoogle([HEAD, ['A', '9876500331', 'C']]); await syncSheets({ db, tokenKey: KEY, google });
    expect(await leadsOf(off.t)).toHaveLength(0); expect(await leadsOf(none.t)).toHaveLength(0); expect(calls.filter((u) => u.includes(`SID6${tag}`))).toHaveLength(0);
    expect(await syncSheets({ db, tokenKey: KEY })).toMatchObject({ connections: 0 });
  });
  it('a sheet tab name that could alter the request is replaced with the default', async () => {
    const { c } = await tenantWith('google_sheets', `gs8-${tag}`, { config: { spreadsheetId: `SID8${tag}`, sheet: "Leads'!A1:Z9&x=" }, expires: '2099-01-01T00:00:00Z' });
    const { google, calls } = fakeGoogle([HEAD]); await syncSheets({ db, tokenKey: KEY, google });
    expect(calls.some((u) => decodeURIComponent(u).includes("Leads'"))).toBe(false); expect(calls.some((u) => decodeURIComponent(u).includes('Sheet1!'))).toBe(true); void c;
  });
});

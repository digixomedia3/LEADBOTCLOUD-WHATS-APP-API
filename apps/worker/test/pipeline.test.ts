import { createServer, type Server } from 'node:http';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { GraphClient, encryptSecret } from '@lbc/meta';
import { ingestWebhook } from '../src/receiver';
import { handleAccountUpdate, handleInbound, handleStatus, handleTemplateStatus, routeTenant } from '../src/handlers';
import { sendOne } from '../src/send';

// Same fallbacks the db package tests use (local dev containers only).
const WORKER_URL = process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud';
const ADMIN_URL = process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud';
const w = createDb(WORKER_URL, { max: 4 });
const admin = createDb(ADMIN_URL, { max: 2 });
const db = w.db;
const KEY = randomBytes(32).toString('base64');
const SECRET = 'worker-test-app-secret';

// ---- fake Graph server: records calls, answers from a script ----
type Reply = { status: number; body: unknown } | 'hangup';
let server: Server, base = '';
const calls: { path: string; body: any; auth?: string }[] = [];
let script: Reply[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      calls.push({ path: req.url ?? '', body: b ? JSON.parse(b) : undefined, auth: req.headers.authorization });
      const r = script.shift() ?? { status: 200, body: { messaging_product: 'whatsapp', messages: [{ id: `wamid.${randomUUID()}` }] } };
      if (r === 'hangup') { req.socket.destroy(); return; }
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  await admin.client.unsafe(`delete from webhook_events where dedupe_key like 'wtest:%' or waba_id like 'wt-waba-%' or dedupe_key like 'bad:%'`);
  await admin.client.unsafe(`delete from audit_log where tenant_id in (select id from tenants where name like 'WT %')`);
  await admin.client.unsafe(`delete from tenants where name like 'WT %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
const graph = () => new GraphClient({ graphVersion: 'v26.0', baseUrl: base, appId: 'APP', appSecret: SECRET, timeoutMs: 3000 });
const okSend = (id = `wamid.${randomUUID()}`, extra: object = {}) => ({ status: 200, body: { messaging_product: 'whatsapp', messages: [{ id, ...extra }] } });
const gerr = (code: number, extra: object = {}) => ({ status: 400, body: { error: { message: 'x', code, ...extra } } });

// ---- fixtures ----
interface Fx { tenant: string; waba: string; pn: string; contact: string; conv: string }
async function fixture(opts: { consent?: 'allowed' | 'stopped' | 'unknown'; tokenStatus?: string; health?: string; window?: boolean; phone?: string } = {}): Promise<Fx> {
  const tenant = randomUUID(), tag = tenant.slice(0, 8), waba = `wt-waba-${tag}`, pn = `wt-pn-${tag}`;
  const phone = opts.phone ?? `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  await admin.client.unsafe(`insert into tenants (id, name) values ('${tenant}', 'WT ${tag}')`);
  await db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${tenant}, ${waba}, ${encryptSecret('TOKEN-' + tag, KEY)}, ${opts.tokenStatus ?? 'valid'}, ${opts.health ?? 'ok'})`);
  const acc = (await db.execute(sql`select id from meta_accounts where tenant_id = ${tenant}`) as unknown as { id: string }[])[0]!;
  await db.execute(sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${tenant}, ${acc.id}, ${pn}, '+91 98765 43210')`);
  const c = (await db.execute(sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${tenant}, ${phone}, 'Asha', ${opts.consent ?? 'allowed'}) returning id`) as unknown as { id: string }[])[0]!;
  const exp = opts.window === false ? null : new Date(Date.now() + 3600_000).toISOString();
  const v = (await db.execute(sql`insert into conversations (tenant_id, contact_id, phone_number_id, window_expires_at) values (${tenant}, ${c.id}, ${pn}, ${exp}::timestamptz) returning id`) as unknown as { id: string }[])[0]!;
  return { tenant, waba, pn, contact: c.id, conv: v.id };
}
async function template(fx: Fx, o: { name?: string; status?: string; category?: string } = {}) {
  await db.execute(sql`insert into templates (tenant_id, name, language, category, status, body, category_current) values (${fx.tenant}, ${o.name ?? 'renewal'}, 'en', ${o.category ?? 'marketing'}, ${o.status ?? 'approved'}, 'Hi {{1}}, your plan ends on {{2}}.', ${o.category ?? 'marketing'})`);
}
async function queued(fx: Fx, o: { template?: boolean; category?: string; recipient?: boolean } = {}) {
  const id = randomUUID();
  let rid: string | null = null;
  if (o.recipient) {
    const camp = (await db.execute(sql`insert into campaigns (tenant_id, name, status) values (${fx.tenant}, 'c', 'running') returning id`) as unknown as { id: string }[])[0]!;
    rid = (await db.execute(sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, state) values (${fx.tenant}, ${camp.id}, ${fx.contact}, '+910', 'queued') returning id`) as unknown as { id: string }[])[0]!.id;
  }
  const isT = o.template ?? true;
  await db.execute(sql`insert into messages (id, tenant_id, conversation_id, direction, kind, body, status, template_name, template_language, template_category, payload, phone_number_id, campaign_recipient_id)
    values (${id}, ${fx.tenant}, ${fx.conv}, 'out', ${isT ? 'template' : 'text'}, ${isT ? 'renewal' : 'Hello there'}, 'queued', ${isT ? 'renewal' : null}, ${isT ? 'en' : null}, ${isT ? (o.category ?? 'marketing') : null}, ${JSON.stringify({ params: ['Asha', '30 Nov'] })}::jsonb, ${fx.pn}, ${rid})`);
  return { id, rid };
}
const deps = () => ({ db, graph: graph(), tokenKey: KEY });
const msg = async (id: string) => (await db.execute(sql`select * from messages where id = ${id}`) as unknown as Record<string, any>[])[0]!;
const contact = async (id: string) => (await db.execute(sql`select * from contacts where id = ${id}`) as unknown as Record<string, any>[])[0]!;
beforeEach(() => { calls.length = 0; script = []; });

describe('webhook receiver (spec 5.2)', () => {
  const body = (extra: object = {}) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: `wt-waba-${randomUUID().slice(0, 8)}`, changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P' }, statuses: [{ id: `wamid.${randomUUID()}`, status: 'sent', timestamp: '1700000000' }], ...extra } }] }] });
  const sig = (b: string) => 'sha256=' + createHmac('sha256', SECRET).update(b).digest('hex');
  it('stores a correctly signed event once and returns 200; a replay stores nothing', async () => {
    const b = body();
    const first = await ingestWebhook(db, Buffer.from(b), sig(b), SECRET);
    const again = await ingestWebhook(db, Buffer.from(b), sig(b), SECRET);
    expect(first.status).toBe(200); expect(first.stored).toBe(1);
    expect(again.stored).toBe(0); expect(again.duplicates).toBe(1);
  });
  it('rejects a bad signature with 401, records it, and processes nothing', async () => {
    const b = body();
    const r = await ingestWebhook(db, Buffer.from(b), 'sha256=' + '0'.repeat(64), SECRET);
    expect(r.status).toBe(401); expect(r.items).toHaveLength(0);
    const bad = await admin.client.unsafe(`select count(*)::int n from webhook_events where signature_ok = false`);
    expect(bad[0]!.n).toBeGreaterThan(0);
  });
  it('routes by WABA, and quarantines a phone number that is not the tenant\'s', async () => {
    const fx = await fixture();
    expect(await routeTenant(db, fx.waba, fx.pn)).toMatchObject({ tenantId: fx.tenant });
    expect(await routeTenant(db, fx.waba, 'someone-elses-number')).toBe('mismatch');
    expect(await routeTenant(db, 'unknown-waba', fx.pn)).toBe('unknown');
    expect(await routeTenant(db, null)).toBe('unknown');
  });
});

describe('send pipeline (spec 4.5)', () => {
  it('happy path: marketing template goes to /marketing_messages with fallback policy, token in the header, accepted != delivered', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx, { recipient: true });
    script.push(okSend('wamid.HAPPY'));
    const r = await sendOne(deps(), fx.tenant, q.id);
    expect(r).toMatchObject({ kind: 'sent', wamid: 'wamid.HAPPY', path: 'mm_api' });
    expect(calls[0]!.path).toBe(`/v26.0/${fx.pn}/marketing_messages`);
    expect(calls[0]!.auth).toMatch(/^Bearer TOKEN-/);
    expect(calls[0]!.body).toMatchObject({ messaging_product: 'whatsapp', type: 'template', product_policy: 'CLOUD_API_FALLBACK', biz_opaque_callback_data: `msg:${q.id}` });
    expect(calls[0]!.body.template.components[0].parameters).toEqual([{ type: 'text', text: 'Asha' }, { type: 'text', text: '30 Nov' }]);
    const m = await msg(q.id);
    expect(m.status).toBe('accepted'); expect(m.wamid).toBe('wamid.HAPPY'); expect(m.send_path).toBe('mm_api');
    const cr = (await db.execute(sql`select state from campaign_recipients where id = ${q.rid}`) as unknown as any[])[0];
    expect(cr.state).toBe('sent');
    expect((await contact(fx.contact)).last_marketing_sent_at).not.toBeNull();
  });
  it('utility templates and in-window text go to /messages', async () => {
    const fx = await fixture(); await template(fx, { category: 'utility' });
    const u = await queued(fx, { category: 'utility' }); await sendOne(deps(), fx.tenant, u.id);
    const t = await queued(fx, { template: false }); await sendOne(deps(), fx.tenant, t.id);
    expect(calls.map((c) => c.path)).toEqual([`/v26.0/${fx.pn}/messages`, `/v26.0/${fx.pn}/messages`]);
  });
  it('IDEMPOTENT: sending the same message twice calls Meta once', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx);
    const [a, b] = await Promise.all([sendOne(deps(), fx.tenant, q.id), sendOne(deps(), fx.tenant, q.id)]);
    await sendOne(deps(), fx.tenant, q.id);
    expect(calls).toHaveLength(1);
    expect([a.kind, b.kind].sort()).toEqual(['sent', 'skipped']);
  });
  it('never messages an opted-out contact, with no Graph call', async () => {
    const fx = await fixture({ consent: 'stopped' }); await template(fx); const q = await queued(fx, { recipient: true });
    expect(await sendOne(deps(), fx.tenant, q.id)).toMatchObject({ kind: 'skipped', reason: 'Customer opted out' });
    expect(calls).toHaveLength(0);
    expect((await db.execute(sql`select state, reason from campaign_recipients where id = ${q.rid}`) as unknown as any[])[0]).toMatchObject({ state: 'skipped', reason: 'Customer opted out' });
  });
  it('a marketing send needs permission on record', async () => {
    const fx = await fixture({ consent: 'unknown' }); await template(fx); const q = await queued(fx);
    expect(await sendOne(deps(), fx.tenant, q.id)).toMatchObject({ kind: 'skipped', reason: 'No permission on record' });
    expect(calls).toHaveLength(0);
  });
  it('re-checks live: expired token, restricted account, unapproved or paused template, held contact, closed window', async () => {
    let fx = await fixture({ tokenStatus: 'invalid' }); await template(fx);
    expect((await sendOne(deps(), fx.tenant, (await queued(fx)).id)) as any).toMatchObject({ kind: 'skipped' });
    fx = await fixture({ health: 'restricted' }); await template(fx);
    expect((await sendOne(deps(), fx.tenant, (await queued(fx)).id)) as any).toMatchObject({ kind: 'skipped' });
    fx = await fixture(); await template(fx, { status: 'paused' });
    expect((await sendOne(deps(), fx.tenant, (await queued(fx)).id)) as any).toMatchObject({ kind: 'skipped', reason: 'The message format is not approved right now.' });
    fx = await fixture(); await template(fx);
    await db.execute(sql`update contacts set freq_cap_hold_until = now() + interval '3 hours' where id = ${fx.contact}`);
    expect((await sendOne(deps(), fx.tenant, (await queued(fx)).id)) as any).toMatchObject({ kind: 'skipped' });
    fx = await fixture({ window: false });
    expect((await sendOne(deps(), fx.tenant, (await queued(fx, { template: false })).id)) as any).toMatchObject({ kind: 'skipped' });
    expect(calls).toHaveLength(0);
  });
  it('tenant A\'s message can never be sent through tenant B (wrong tenant id finds nothing)', async () => {
    const a = await fixture(), b = await fixture(); await template(a); const q = await queued(a);
    expect(await sendOne(deps(), b.tenant, q.id)).toMatchObject({ kind: 'skipped', reason: 'message_missing' });
    expect(calls).toHaveLength(0);
  });
  it('NETWORK DROP on a marketing send => send_unknown, and a re-run does NOT send again (spec 4.5 step 6)', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx);
    script.push('hangup');
    expect(await sendOne(deps(), fx.tenant, q.id)).toEqual({ kind: 'unknown_outcome' });
    expect((await msg(q.id)).status).toBe('send_unknown');
    await sendOne(deps(), fx.tenant, q.id);
    expect(calls).toHaveLength(1);
  });
  it('131049 marks the recipient capped, holds the contact 24h, and is NOT retried', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx, { recipient: true });
    script.push(gerr(131049));
    const r = await sendOne(deps(), fx.tenant, q.id);
    expect(r).toMatchObject({ kind: 'failed', code: 131049, action: 'hold_contact_24h' });
    expect((await db.execute(sql`select state from campaign_recipients where id = ${q.rid}`) as unknown as any[])[0].state).toBe('capped');
    expect((await contact(fx.contact)).freq_cap_hold_until).not.toBeNull();
    expect(calls).toHaveLength(1);
  });
  it('131047 (outside window) fails without retry; 131026 marks the contact unreachable', async () => {
    let fx = await fixture(); await template(fx, { category: 'utility' });
    script.push(gerr(131047));
    expect(await sendOne(deps(), fx.tenant, (await queued(fx, { category: 'utility' })).id)).toMatchObject({ kind: 'failed', action: 'suggest_template' });
    fx = await fixture(); await template(fx);
    script.push(gerr(131026));
    await sendOne(deps(), fx.tenant, (await queued(fx)).id);
    expect((await contact(fx.contact)).reachability).toBe('unreachable');
  });
  it('130429 (throughput) is re-queued with a backoff delay instead of failing', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx, { recipient: true });
    script.push(gerr(130429));
    const r = await sendOne(deps(), fx.tenant, q.id);
    expect(r).toMatchObject({ kind: 'retry', code: 130429 }); expect((r as any).delayMs).toBe(1000);
    expect((await msg(q.id)).status).toBe('queued');
    expect((await db.execute(sql`select state from campaign_recipients where id = ${q.rid}`) as unknown as any[])[0].state).toBe('retry_wait');
    script.push(okSend('wamid.RETRY'));
    expect(await sendOne(deps(), fx.tenant, q.id)).toMatchObject({ kind: 'sent', wamid: 'wamid.RETRY' });
  });
  it('190 (token invalid) pauses the account and running campaigns and asks to reconnect', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx, { recipient: true });
    script.push(gerr(190));
    expect(await sendOne(deps(), fx.tenant, q.id)).toMatchObject({ kind: 'failed', action: 'reconnect' });
    expect((await db.execute(sql`select token_status from meta_accounts where tenant_id = ${fx.tenant}`) as unknown as any[])[0].token_status).toBe('invalid');
    expect((await db.execute(sql`select status, pause_reason from campaigns where tenant_id = ${fx.tenant}`) as unknown as any[])[0]).toMatchObject({ status: 'paused', pause_reason: 'reconnect' });
  });
  it('131063 re-routes the marketing send to /messages... and 131055 from MM back to /messages', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx);
    script.push(gerr(131055), okSend('wamid.REROUTED'));
    const r = await sendOne(deps(), fx.tenant, q.id);
    expect(r).toMatchObject({ kind: 'sent', wamid: 'wamid.REROUTED', path: 'cloud_api' });
    expect(calls.map((c) => c.path.split('/').pop())).toEqual(['marketing_messages', 'messages']);
  });
  it('an UNKNOWN error code is dead-lettered, not guessed', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx);
    script.push(gerr(987654));
    expect(await sendOne(deps(), fx.tenant, q.id)).toMatchObject({ kind: 'failed', known: false, action: 'dlq' });
  });
  it('held_for_quality_assessment is stored as held, not as sent', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx);
    script.push(okSend('wamid.HELD', { message_status: 'held_for_quality_assessment' }));
    expect(await sendOne(deps(), fx.tenant, q.id)).toMatchObject({ kind: 'sent', held: true });
    expect((await msg(q.id)).status).toBe('held');
  });
});

describe('status webhooks (spec 5.4)', () => {
  const sendIt = async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx, { recipient: true });
    const wamid = `wamid.${randomUUID()}`; script.push(okSend(wamid)); await sendOne(deps(), fx.tenant, q.id);
    return { fx, q, wamid };
  };
  it('moves forward only: delivered then a late "sent" does not downgrade', async () => {
    const { fx, q, wamid } = await sendIt();
    await handleStatus(db, fx.tenant, { id: wamid, status: 'delivered', timestamp: '1700000010' }, 0);
    await handleStatus(db, fx.tenant, { id: wamid, status: 'sent', timestamp: '1700000005' }, 0);
    const m = await msg(q.id);
    expect(m.status).toBe('delivered'); expect(m.delivered_at).not.toBeNull();
  });
  it('read without delivered still sets delivered_at; replays change nothing', async () => {
    const { fx, q, wamid } = await sendIt();
    const s = { id: wamid, status: 'read', timestamp: '1700000020' };
    await handleStatus(db, fx.tenant, s, 0); await handleStatus(db, fx.tenant, s, 0);
    const m = await msg(q.id);
    expect(m.status).toBe('read'); expect(m.delivered_at).not.toBeNull(); expect(m.read_at).not.toBeNull();
    expect((await db.execute(sql`select count(*)::int n from message_status_events where wamid = ${wamid}`) as unknown as any[])[0].n).toBe(1);
    expect((await db.execute(sql`select state from campaign_recipients where id = ${q.rid}`) as unknown as any[])[0].state).toBe('read');
  });
  it('pricing is written on the FIRST occurrence only; billable means type regular', async () => {
    const { fx, q, wamid } = await sendIt();
    await handleStatus(db, fx.tenant, { id: wamid, status: 'sent', pricing: { category: 'marketing_lite', type: 'regular' } }, 0);
    await handleStatus(db, fx.tenant, { id: wamid, status: 'delivered', pricing: { category: 'marketing', type: 'free_customer_service' } }, 0);
    const m = await msg(q.id);
    expect(m.pricing_category).toBe('marketing_lite'); expect(m.billable).toBe(true); expect(m.send_path).toBe('mm_api');
  });
  it('a status that arrives BEFORE the wamid is saved is joined through biz_opaque_callback_data', async () => {
    const fx = await fixture(); await template(fx); const q = await queued(fx);
    const out = await handleStatus(db, fx.tenant, { id: 'wamid.NOTYET', status: 'sent', biz_opaque_callback_data: `msg:${q.id}` }, 0);
    expect(out).toBe('ok'); expect((await msg(q.id)).wamid).toBe('wamid.NOTYET');
  });
  it('an unknown message is retried a few times, then dropped as orphaned', async () => {
    const fx = await fixture();
    expect(await handleStatus(db, fx.tenant, { id: 'wamid.NOPE', status: 'sent' }, 0)).toBe('orphan_retry');
    expect(await handleStatus(db, fx.tenant, { id: 'wamid.NOPE', status: 'sent' }, 5)).toBe('ignored');
  });
  it('failed is terminal; a failed 131049 marks the recipient capped and holds the contact', async () => {
    const { fx, q, wamid } = await sendIt();
    await handleStatus(db, fx.tenant, { id: wamid, status: 'failed', recipient_id: (await contact(fx.contact)).phone_e164.slice(1), errors: [{ code: 131049, title: 'x' }] }, 0);
    await handleStatus(db, fx.tenant, { id: wamid, status: 'read' }, 0);
    expect((await msg(q.id)).status).toBe('failed');
    expect((await db.execute(sql`select state from campaign_recipients where id = ${q.rid}`) as unknown as any[])[0].state).toBe('capped');
    expect((await contact(fx.contact)).freq_cap_hold_until).not.toBeNull();
  });
  it('a status for another tenant\'s message is not applied (tenant filter)', async () => {
    const { q, wamid } = await sendIt(); const other = await fixture();
    expect(await handleStatus(db, other.tenant, { id: wamid, status: 'read' }, 5)).toBe('ignored');
    expect((await msg(q.id)).status).not.toBe('read');
  });
});

describe('inbound messages (spec 5.5)', () => {
  const inbound = (fx: Fx, phone: string, text: string, id = `wamid.in.${randomUUID()}`) => handleInbound(db, fx.tenant, fx.pn, { id, from: phone.replace('+', ''), type: 'text', text: { body: text }, timestamp: String(Math.floor(Date.now() / 1000)), _contacts: [{ wa_id: phone.replace('+', ''), profile: { name: 'Ravi' } }] });
  it('a new customer creates a contact with NO consent, opens the 24h window, and stores the message once', async () => {
    const fx = await fixture(); const phone = '+919811122233';
    const a = await inbound(fx, phone, 'hello', 'wamid.in.1'); const b = await inbound(fx, phone, 'hello', 'wamid.in.1');
    expect(a.outcome).toBe('ok');
    const c = (await db.execute(sql`select * from contacts where tenant_id = ${fx.tenant} and phone_e164 = ${phone}`) as unknown as any[])[0];
    expect(c.consent_status).toBe('unknown'); expect(c.profile_name).toBe('Ravi');
    const conv = (await db.execute(sql`select window_expires_at, unread from conversations where tenant_id = ${fx.tenant} and contact_id = ${c.id}`) as unknown as any[])[0];
    expect(new Date(conv.window_expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(conv.unread).toBe(1);
    expect((await db.execute(sql`select count(*)::int n from messages where wamid = 'wamid.in.1'`) as unknown as any[])[0].n).toBe(1);
    expect(b.outcome).toBe('ok');
  });
  it('STOP opts the customer out with a consent record; START (from them) resumes', async () => {
    const fx = await fixture({ phone: '+919822233344' });
    const r = await inbound(fx, '+919822233344', 'STOP');
    expect(r.optedOut).toBe(true);
    expect((await contact(fx.contact)).consent_status).toBe('stopped');
    const ev = await db.execute(sql`select action, source from contact_consent_events where contact_id = ${fx.contact}`) as unknown as any[];
    expect(ev.map((e) => e.action)).toContain('opt_out');
    await inbound(fx, '+919822233344', 'START');
    expect((await contact(fx.contact)).consent_status).toBe('allowed');
  });
  it('a STOP quick-reply button payload opts out', async () => {
    const fx = await fixture({ phone: '+919833344455' });
    await handleInbound(db, fx.tenant, fx.pn, { id: `wamid.in.${randomUUID()}`, from: '919833344455', type: 'button', button: { payload: 'STOP:c_456', text: 'Stop promotions' }, timestamp: String(Math.floor(Date.now() / 1000)) });
    expect((await contact(fx.contact)).consent_status).toBe('stopped');
  });
  it('words that merely contain "stop" do not opt anyone out', async () => {
    const fx = await fixture({ phone: '+919844455566' });
    const r = await inbound(fx, '+919844455566', 'please do not stop the offer');
    expect(r.optedOut).toBeFalsy(); expect((await contact(fx.contact)).consent_status).toBe('allowed');
  });
  it('keyword auto-replies fire for the right tenant only', async () => {
    const fx = await fixture({ phone: '+919855566677' }), other = await fixture();
    await db.execute(sql`insert into automation_rules (tenant_id, name, kind, keywords, reply) values (${fx.tenant}, 'price', 'keyword', ARRAY['price'], 'Plans start at 499')`);
    expect((await inbound(fx, '+919855566677', 'what is the price?')).autoReply).toBe('Plans start at 499');
    expect((await inbound(other, '+919866677788', 'what is the price?')).autoReply).toBeUndefined();
  });
  it('a sender with no phone number (username/BSUID only) is ignored, never guessed', async () => {
    const fx = await fixture();
    expect((await handleInbound(db, fx.tenant, fx.pn, { id: 'wamid.in.bsuid', type: 'text', text: { body: 'hi' } })).outcome).toBe('ignored');
  });
});

describe('template + account events (spec 5.5)', () => {
  const ev = (fx: Fx, event: string, extra: object = {}) => handleTemplateStatus(db, fx.tenant, { event, message_template_name: 'renewal', message_template_language: 'en', ...extra });
  it('approve / reject / pause (3h then 6h) / disable / reinstate', async () => {
    const fx = await fixture(); await template(fx, { status: 'pending' });
    const t = async () => (await db.execute(sql`select status, pause_count, paused_until, rejection_reason from templates where tenant_id = ${fx.tenant}`) as unknown as any[])[0];
    await ev(fx, 'REJECTED', { reason: 'INVALID_FORMAT' }); expect(await t()).toMatchObject({ status: 'rejected', rejection_reason: 'INVALID_FORMAT' });
    await ev(fx, 'APPROVED'); expect((await t()).status).toBe('approved');
    const camp = await db.execute(sql`insert into campaigns (tenant_id, name, status, template_id) values (${fx.tenant}, 'c', 'running', (select id from templates where tenant_id = ${fx.tenant})) returning id`) as unknown as any[];
    await ev(fx, 'PAUSED');
    let x = await t(); expect(x.status).toBe('paused'); expect(x.pause_count).toBe(1);
    expect(Math.round((new Date(x.paused_until).getTime() - Date.now()) / 3600_000)).toBe(3);
    expect((await db.execute(sql`select status from campaigns where id = ${camp[0].id}`) as unknown as any[])[0].status).toBe('paused');
    await ev(fx, 'UNPAUSE'); expect((await t()).status).toBe('approved');
    expect((await db.execute(sql`select status from campaigns where id = ${camp[0].id}`) as unknown as any[])[0].status).toBe('scheduled');
    await ev(fx, 'PAUSED'); x = await t(); expect(Math.round((new Date(x.paused_until).getTime() - Date.now()) / 3600_000)).toBe(6);
    await ev(fx, 'DISABLED'); expect((await t()).status).toBe('disabled');
  });
  it('an unknown template event is ignored, not guessed', async () => {
    const fx = await fixture(); await template(fx);
    expect(await ev(fx, 'SOMETHING_NEW')).toBe('ignored');
  });
  it('account restriction pauses every campaign; partner removal revokes the token and offboards', async () => {
    const fx = await fixture(); await template(fx);
    await db.execute(sql`insert into campaigns (tenant_id, name, status) values (${fx.tenant}, 'c', 'running')`);
    expect(await handleAccountUpdate(db, fx.tenant, { event: 'ACCOUNT_RESTRICTION' })).toBe('ok');
    expect((await db.execute(sql`select health_state from meta_accounts where tenant_id = ${fx.tenant}`) as unknown as any[])[0].health_state).toBe('restricted');
    expect((await db.execute(sql`select status, pause_reason from campaigns where tenant_id = ${fx.tenant}`) as unknown as any[])[0]).toMatchObject({ status: 'paused', pause_reason: 'account_restricted' });
    await handleAccountUpdate(db, fx.tenant, { event: 'PARTNER_REMOVED' });
    expect((await db.execute(sql`select token_status from meta_accounts where tenant_id = ${fx.tenant}`) as unknown as any[])[0].token_status).toBe('revoked');
    expect((await db.execute(sql`select status from tenants where id = ${fx.tenant}`) as unknown as any[])[0].status).toBe('offboarded');
  });
});

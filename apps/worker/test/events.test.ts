import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@lbc/db';
import { encryptSecret, explodeWebhook } from '@lbc/meta';
import { processEvent } from '../src/events';

const src = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const w = createDb(process.env.DATABASE_URL_WORKER ?? pick(/process\.env\.DATABASE_URL_WORKER \?\?\s*'([^']+)'/), { max: 3 });
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const db = w.db;
const KEY = randomBytes(32).toString('base64');
afterAll(async () => {
  await admin.client.unsafe(`delete from webhook_events where waba_id like 'ev-waba-%'`);
  await admin.client.unsafe(`delete from audit_log where tenant_id in (select id from tenants where name like 'EV %')`);
  await admin.client.unsafe(`delete from tenants where name like 'EV %'`);
  await Promise.all([w.client.end(), admin.client.end()]);
});
const q = async <T = any>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];

async function tenant() {
  const id = randomUUID(), tag = id.slice(0, 8), waba = `ev-waba-${tag}`, pn = `ev-pn-${tag}`;
  await admin.client.unsafe(`insert into tenants (id, name) values ('${id}', 'EV ${tag}')`);
  await db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${id}, ${waba}, ${encryptSecret('T', KEY)}, 'valid', 'ok')`);
  const acc = (await q<{ id: string }>(sql`select id from meta_accounts where tenant_id = ${id}`))[0]!;
  await db.execute(sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${id}, ${acc.id}, ${pn}, '+91 90000 00000')`);
  return { id, waba, pn };
}
/** Stores a webhook exactly as the receiver does, then runs it through the real dispatcher. */
async function deliver(waba: string, field: string, value: Record<string, unknown>) {
  const items = explodeWebhook({ object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{ field, value }] }] });
  const outs = [];
  for (const it of items) {
    const ins = (await q<{ id: number }>(sql`insert into webhook_events (signature_ok, waba_id, phone_number_id, field, dedupe_key, payload) values (true, ${it.wabaId}, ${it.phoneNumberId ?? null}, ${it.field}, ${it.dedupeKey + ':' + randomUUID()}, ${JSON.stringify({ kind: it.kind, ...(it.payload as object) })}::jsonb) returning id`))[0]!;
    const row = (await q(sql`select * from webhook_events where id = ${ins.id}`))[0]!;
    outs.push({ out: await processEvent(db, row, 0), id: ins.id });
  }
  return outs;
}

describe('processEvent dispatch (every event type reaches its handler)', () => {
  it('message_template_status_update APPROVED / REJECTED / PAUSED change the format', async () => {
    const t = await tenant();
    await db.execute(sql`insert into templates (tenant_id, name, language, category, status, body) values (${t.id}, 'promo', 'en', 'marketing', 'pending', 'Hi')`);
    const st = async () => (await q(sql`select status, rejection_reason from templates where tenant_id = ${t.id}`))[0]!;
    await deliver(t.waba, 'message_template_status_update', { event: 'APPROVED', message_template_id: 1, message_template_name: 'promo', message_template_language: 'en' });
    expect((await st()).status).toBe('approved');
    await deliver(t.waba, 'message_template_status_update', { event: 'PAUSED', message_template_name: 'promo', message_template_language: 'en' });
    expect((await st()).status).toBe('paused');
    await deliver(t.waba, 'message_template_status_update', { event: 'REJECTED', message_template_name: 'promo', message_template_language: 'en', reason: 'INVALID_FORMAT' });
    expect(await st()).toMatchObject({ status: 'rejected', rejection_reason: 'INVALID_FORMAT' });
  });
  it('account_update ACCOUNT_RESTRICTION restricts the account', async () => {
    const t = await tenant();
    await deliver(t.waba, 'account_update', { event: 'ACCOUNT_RESTRICTION' });
    expect((await q(sql`select health_state from meta_accounts where tenant_id = ${t.id}`))[0]!.health_state).toBe('restricted');
  });
  it('a customer message and a status go through too', async () => {
    const t = await tenant();
    const phone = '919855500011';
    await deliver(t.waba, 'messages', { messaging_product: 'whatsapp', metadata: { phone_number_id: t.pn }, contacts: [{ wa_id: phone, profile: { name: 'Ravi' } }], messages: [{ from: phone, id: 'wamid.ev.' + randomUUID(), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hello' } }] });
    expect((await q(sql`select count(*)::int n from contacts where tenant_id = ${t.id}`))[0]!.n).toBe(1);
    // A status for a message we do not know yet must be retried (it may arrive before our wamid is saved), never dropped.
    await expect(deliver(t.waba, 'messages', { messaging_product: 'whatsapp', metadata: { phone_number_id: t.pn }, statuses: [{ id: 'wamid.unknown', status: 'sent' }] })).rejects.toThrow(/will retry/);
  });
  it('an unknown event type is stored and marked ignored with its name, not dropped silently', async () => {
    const t = await tenant();
    const r = await deliver(t.waba, 'brand_new_meta_field', { anything: true });
    expect(r[0]!.out).toBe('ignored');
    expect((await q(sql`select process_error from webhook_events where id = ${r[0]!.id}`))[0]!.process_error).toBe('ignored: brand_new_meta_field');
  });
  it('an event for an unknown WABA is stored as unrouted, never applied', async () => {
    const r = await deliver('ev-waba-nobody', 'account_update', { event: 'PARTNER_REMOVED' });
    expect(r[0]!.out).toBe('unrouted');
    expect((await q(sql`select process_error from webhook_events where id = ${r[0]!.id}`))[0]!.process_error).toMatch(/unknown WABA/);
  });
  it('an event naming another tenant\'s phone number is quarantined', async () => {
    const a = await tenant(), b = await tenant();
    const r = await deliver(a.waba, 'messages', { messaging_product: 'whatsapp', metadata: { phone_number_id: b.pn }, messages: [{ from: '919800000001', id: 'wamid.q.' + randomUUID(), timestamp: '1700000000', type: 'text', text: { body: 'x' } }] });
    expect(r[0]!.out).toBe('quarantined');
    expect((await q(sql`select count(*)::int n from contacts where tenant_id in (${a.id}, ${b.id})`))[0]!.n).toBe(0);
  });
  it('processing the same stored event twice changes nothing the second time', async () => {
    const t = await tenant();
    const items = explodeWebhook({ entry: [{ id: t.waba, changes: [{ field: 'account_update', value: { event: 'ACCOUNT_RESTRICTION' } }] }] });
    const ins = (await q<{ id: number }>(sql`insert into webhook_events (signature_ok, waba_id, field, dedupe_key, payload) values (true, ${t.waba}, 'account_update', ${'dd:' + randomUUID()}, ${JSON.stringify({ kind: items[0]!.kind, ...(items[0]!.payload as object) })}::jsonb) returning id`))[0]!;
    const row = (await q(sql`select * from webhook_events where id = ${ins.id}`))[0]!;
    expect(await processEvent(db, row, 0)).toBe('ok');
    const again = (await q(sql`select * from webhook_events where id = ${ins.id}`))[0]!;
    expect(await processEvent(db, again, 0)).toBe('done');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, withTenant } from '../src';

// Deleting a contact must leave their number NOWHERE. Run as the real web role, then scan every text, JSON and array column in the database.
const app = createDb(process.env.DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const worker = createDb(process.env.DATABASE_URL_WORKER ?? 'postgres://worker:worker_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const owner = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? 'postgres://postgres:postgres_dev_password@localhost:5433/leadbotcloud', { max: 2 });
const A = randomUUID(), B = randomUUID(), tag = A.slice(0, 8);
const digits = '9199' + String(parseInt(tag, 16) % 100000000).padStart(8, '0');   // unique to this run, so a scan can only find our own rows
const phone = '+' + digits;
// Differs from the victim only in the last digit, so any match looser than the exact number would wrongly scrub (or find) this contact too.
const nearDigits = digits.slice(0, -1) + String((Number(digits.at(-1)) + 1) % 10);
const rows = (r: unknown) => r as Record<string, any>[];
let victimA = '', victimB = '', bystander = '';

async function seed(t: string, ph: string) {
  const c = rows(await worker.db.execute(sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${t}, ${ph}, 'Erase Me', 'allowed') returning id`))[0]!;
  const v = rows(await worker.db.execute(sql`insert into conversations (tenant_id, contact_id, status) values (${t}, ${c.id}, 'open') returning id`))[0]!;
  const m = rows(await worker.db.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status) values (${t}, ${v.id}, 'in', 'image', 'Photo', 'received') returning id`))[0]!;
  await worker.db.execute(sql`insert into inbound_media (tenant_id, message_id, kind, meta_media_id, mime, state, data, size_bytes) values (${t}, ${m.id}, 'image', 'M1', 'image/png', 'stored', ${Buffer.from('x')}, 1)`);
  const camp = rows(await worker.db.execute(sql`insert into campaigns (tenant_id, name, status) values (${t}, 'c', 'completed') returning id`))[0]!;
  await worker.db.execute(sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, state) values (${t}, ${camp.id}, ${c.id}, ${ph}, 'read')`);
  await worker.db.execute(sql`insert into leads (tenant_id, contact_id, status) values (${t}, ${c.id}, 'new')`);
  const pn = 'er-pn-' + t.slice(0, 8);
  await owner.client.unsafe(`insert into webhook_events (signature_ok, phone_number_id, field, dedupe_key, payload) values (true, '${pn}', 'messages', 'er:${c.id}', '${JSON.stringify({ kind: 'message', from: ph.slice(1), id: 'wamid.x', _contacts: [{ wa_id: ph.slice(1), profile: { name: 'Erase Me' } }] })}'::jsonb)`);
  await owner.client.unsafe(`insert into webhook_events (signature_ok, phone_number_id, field, dedupe_key, payload) values (true, '${pn}', 'messages', 'er2:${c.id}', '${JSON.stringify({ kind: 'status', recipient_id: ph.slice(1), status: 'read' })}'::jsonb)`);
  return String(c.id);
}
beforeAll(async () => {
  await owner.client.unsafe(`insert into tenants (id, name) values ('${A}', 'ER A'), ('${B}', 'ER B')`);
  for (const t of [A, B]) {
    const acc = rows(await worker.db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${t}, ${'er-waba-' + t.slice(0, 8)}, 'x', 'valid', 'ok') returning id`))[0]!;
    await worker.db.execute(sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${t}, ${acc.id}, ${'er-pn-' + t.slice(0, 8)}, '+91 9')`);
  }
  victimA = await seed(A, phone);
  victimB = await seed(B, phone);                       // a DIFFERENT workspace that happens to hold the same number: must not be touched
  bystander = await seed(A, '+' + nearDigits); // another contact in the same workspace with a near-identical number: must not be touched
});
afterAll(async () => {
  await owner.client.unsafe(`delete from webhook_events where dedupe_key like 'er:%' or dedupe_key like 'er2:%'`);
  await owner.client.unsafe(`delete from tenants where id in ('${A}','${B}')`);
  await Promise.all([app.client.end(), worker.client.end(), owner.client.end()]);
});

/** Every table.column that can hold text, scanned for a number. Returns where it was found. */
async function whereIs(num: string): Promise<string[]> {
  const cols = rows(await owner.client.unsafe(`select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type in ('text','character varying','jsonb','json','ARRAY') and table_name not in ('_lbc_migrations') order by 1, 2`));
  const found: string[] = [];
  for (const c of cols) {
    const n = rows(await owner.client.unsafe(`select count(*)::int as n from "${c.table_name}" where "${c.column_name}"::text like '%${num}%'`))[0]!.n;
    if (Number(n) > 0) found.push(`${c.table_name}.${c.column_name} x${n}`);
  }
  return found;
}

describe('erasing a contact leaves no copy of their number', () => {
  it('before deleting, the number really is in several places (so the scan can see it)', async () => {
    const f = await whereIs(digits);
    expect(f.some((x) => x.startsWith('contacts.phone_e164'))).toBe(true);
    expect(f.some((x) => x.startsWith('campaign_recipients.phone_e164'))).toBe(true);
    expect(f.some((x) => x.startsWith('webhook_events.payload'))).toBe(true);
  });
  it('after the web role deletes the contact, nothing in this workspace holds the number; the other workspace is untouched', async () => {
    await withTenant(app.db, { tenantId: A }, (tx) => tx.execute(sql`delete from contacts where id = ${victimA}`));
    // The other workspace still holds this number, so it must still be found there and ONLY there.
    const f = await whereIs(digits);
    const inA = rows(await owner.client.unsafe(`select (select count(*) from contacts where tenant_id='${A}' and phone_e164 like '%${digits}%')::int a, (select count(*) from webhook_events where phone_number_id='er-pn-${A.slice(0, 8)}' and payload::text like '%${digits}%')::int b, (select count(*) from campaign_recipients where tenant_id='${A}' and phone_e164 like '%${digits}%')::int c`))[0]!;
    expect([inA.a, inA.b, inA.c]).toEqual([0, 0, 0]);
    expect(f.length).toBeGreaterThan(0);   // still present for workspace B
    expect(Number(rows(await owner.client.unsafe(`select count(*)::int n from webhook_events where phone_number_id='er-pn-${B.slice(0, 8)}' and payload::text like '%${digits}%'`))[0]!.n)).toBe(2);
    expect(Number(rows(await owner.client.unsafe(`select count(*)::int n from campaign_recipients where tenant_id='${B}' and phone_e164 = '${phone}'`))[0]!.n)).toBe(1);
  });
  it('the chat, messages, files, lead and recipient row of the erased contact are gone or blanked', async () => {
    const left = rows(await owner.client.unsafe(`select (select count(*) from conversations where tenant_id='${A}' and contact_id='${victimA}')::int c, (select count(*) from leads where tenant_id='${A}' and contact_id='${victimA}')::int l, (select count(*) from inbound_media where tenant_id='${A}' and message_id in (select id from messages where conversation_id in (select id from conversations where contact_id='${victimA}')))::int i, (select count(*) from campaign_recipients where tenant_id='${A}' and phone_e164='erased')::int r`))[0]!;
    expect([left.c, left.l, left.i]).toEqual([0, 0, 0]); expect(Number(left.r)).toBe(1);   // the row stays (for the campaign's counts), the number does not
  });
  it('the erased webhooks keep only their kind, so counts and debugging still work; the bystander webhooks are intact', async () => {
    const pn = 'er-pn-' + A.slice(0, 8);
    const get = async (key: string) => rows(await owner.client.unsafe(`select payload from webhook_events where phone_number_id='${pn}' and dedupe_key = '${key}'`))[0]!.payload;
    expect(await get('er:' + victimA)).toEqual({ erased: true, kind: 'message' });
    expect(await get('er2:' + victimA)).toEqual({ erased: true, kind: 'status' });
    expect((await get('er:' + bystander))._contacts[0].profile.name).toBe('Erase Me');
    expect((await get('er2:' + bystander)).recipient_id).toBe(nearDigits);
  });
  it('another contact in the same workspace keeps everything, and the second workspace keeps its copy', async () => {
    const keep = rows(await owner.client.unsafe(`select (select count(*) from conversations where contact_id='${bystander}')::int a, (select count(*) from campaign_recipients where contact_id='${bystander}' and phone_e164 = '+${nearDigits}')::int b, (select count(*) from conversations where contact_id='${victimB}')::int c`))[0]!;
    expect([keep.a, keep.b, keep.c]).toEqual([1, 1, 1]);
  });
  it('deleting the second workspace contact later leaves the number nowhere in the whole database', async () => {
    await withTenant(app.db, { tenantId: B }, (tx) => tx.execute(sql`delete from contacts where id = ${victimB}`));
    expect(await whereIs(digits)).toEqual([]);   // the complete scan: no table, no column
  });
  it('removing a whole workspace erases its contacts the same way (the trigger runs for each)', async () => {
    const t = randomUUID(); const ph = '+9177' + digits.slice(4); const d = ph.slice(1);
    await owner.client.unsafe(`insert into tenants (id, name) values ('${t}', 'ER C')`);
    const acc = rows(await worker.db.execute(sql`insert into meta_accounts (tenant_id, messaging_account_id, business_token_enc, token_status, health_state) values (${t}, ${'er-waba-' + t.slice(0, 8)}, 'x', 'valid', 'ok') returning id`))[0]!;
    await worker.db.execute(sql`insert into phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number) values (${t}, ${acc.id}, ${'er-pn-' + t.slice(0, 8)}, '+91 9')`);
    await seed(t, ph);
    expect((await whereIs(d)).length).toBeGreaterThan(0);
    await owner.client.unsafe(`delete from tenants where id = '${t}'`);
    expect(await whereIs(d)).toEqual([]);
  });
});

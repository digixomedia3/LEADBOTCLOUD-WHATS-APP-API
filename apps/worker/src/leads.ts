import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';
import { decideConsent, extractLead, parseBody, phoneFromLead, planLimits, type ConsentMode } from '@lbc/shared';

type Row = Record<string, any>;
const rows = async (db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];
/** text[] from a JS array without relying on driver array binding. */
const textArr = (a: string[]) => sql`(select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(a)}::jsonb) x)`;

export const hashSecret = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export type LeadResult =
  | { status: 200; leadId: string; created: boolean; consent: 'allowed' | 'unknown' | 'stopped' }
  | { status: 400 | 401 | 402 | 403 | 404 | 413 | 422; error: string };

const MAX_BODY = 64 * 1024;

/**
 * The only way a lead enters the system from outside. Order matters and every refusal is explicit:
 * unknown source -> 404 (reveals nothing), wrong secret -> 401, disabled -> 403, unreadable body -> 400, no usable phone -> 422, plan full -> 402.
 * Refusals after the source is proven are recorded in lead_rejects so the owner can see why leads are missing.
 */
export async function ingestLead(db: Db, publicId: string, secret: string | undefined, raw: Buffer, contentType: string | undefined): Promise<LeadResult> {
  const src = (await rows(db, sql`select * from lead_sources where public_id = ${publicId}`))[0];
  if (!src) return { status: 404, error: 'Unknown lead source.' };
  if (src.secret_hash && (!secret || !safeEq(hashSecret(secret), src.secret_hash))) return { status: 401, error: 'Wrong or missing key.' };
  if (!src.enabled) return { status: 403, error: 'This lead source is switched off.' };
  const reject = async (reason: string, detail: string, sample?: unknown) => {
    await db.execute(sql`insert into lead_rejects (tenant_id, source_id, reason, detail, sample) values (${src.tenant_id}, ${src.id}, ${reason}, ${detail.slice(0, 300)}, ${sample === undefined ? null : JSON.stringify(sample).slice(0, 2000)}::jsonb)`);
  };
  if (raw.length > MAX_BODY) { await reject('too_large', `${raw.length} bytes`); return { status: 413, error: 'Payload too large.' }; }

  const body = parseBody(raw.toString('utf8'), contentType);
  if (body === null) { await reject('unreadable', 'Body was not JSON or form data.'); return { status: 400, error: 'Send JSON or form data.' }; }

  const lead = extractLead(body, (src.field_map ?? {}) as Record<string, string>);
  const phone = phoneFromLead(lead);
  if (!phone.ok) { await reject('invalid_phone', phone.reason, { fields: Object.keys(lead.fields).slice(0, 12), phone: lead.phone ? String(lead.phone).slice(0, 4) + '…' : null }); return { status: 422, error: phone.reason }; }

  const decision = decideConsent(src.consent_mode as ConsentMode, lead);
  const tenant = (await rows(db, sql`select plan_id from tenants where id = ${src.tenant_id}`))[0];
  const limit = planLimits(tenant?.plan_id ?? 'free').contacts;

  let out: LeadResult = { status: 422, error: 'unreachable' };
  let overLimit = false;
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    let c = (await rows(t, sql`select id, consent_status, name, email from contacts where tenant_id = ${src.tenant_id} and phone_e164 = ${phone.e164} for update`))[0];
    let createdContact = false;
    if (!c) {
      const n = Number((await rows(t, sql`select count(*)::int as n from contacts where tenant_id = ${src.tenant_id}`))[0]!.n);
      if (n >= limit) { overLimit = true; return; }
      const grant = decision.status === 'allowed';
      // Two simultaneous first posts can both get here; the unique index decides, and the loser reads the winner's row.
      c = (await rows(t, sql`insert into contacts (tenant_id, phone_e164, name, email, tags, consent_status, consent_source, consent_at, attributes)
        values (${src.tenant_id}, ${phone.e164}, ${lead.name}, ${lead.email}, ${textArr([...new Set([...(src.default_tags ?? []), ...lead.tags])])}, ${grant ? 'allowed' : 'unknown'}, ${grant ? decision.source : null}, ${grant ? sql`now()` : null}, '{}'::jsonb)
        on conflict (tenant_id, phone_e164) do nothing returning id, consent_status`))[0];
      if (!c) c = (await rows(t, sql`select id, consent_status, name, email from contacts where tenant_id = ${src.tenant_id} and phone_e164 = ${phone.e164} for update`))[0]!;
      else createdContact = true;
      if (grant && createdContact) await t.execute(sql`insert into contact_consent_events (tenant_id, contact_id, action, source, note) values (${src.tenant_id}, ${c.id}, 'opt_in', ${decision.source}, ${'Lead source: ' + src.name + ' (' + decision.reason + ')'})`);
    }
    if (c && !createdContact) {
      // Never override a STOP automatically, and never downgrade existing consent. Only fill gaps and upgrade unknown -> allowed.
      const grant = decision.status === 'allowed' && c.consent_status === 'unknown';
      await t.execute(sql`update contacts set name = coalesce(name, ${lead.name}), email = coalesce(email, ${lead.email}),
        tags = (select coalesce(array_agg(distinct x), '{}'::text[]) from unnest(tags || ${textArr([...(src.default_tags ?? []), ...lead.tags])}) x),
        consent_status = case when ${grant} then 'allowed' else consent_status end,
        consent_source = case when ${grant} then ${decision.source} else consent_source end,
        consent_at = case when ${grant} then now() else consent_at end, updated_at = now() where id = ${c.id}`);
      if (grant) await t.execute(sql`insert into contact_consent_events (tenant_id, contact_id, action, source, note) values (${src.tenant_id}, ${c.id}, 'opt_in', ${decision.source}, ${'Lead source: ' + src.name + ' (' + decision.reason + ')'})`);
    }
    const consentNow = (await rows(t, sql`select consent_status from contacts where id = ${c.id}`))[0]!.consent_status as 'allowed' | 'unknown' | 'stopped';
    if (src.default_group_id) await t.execute(sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${src.tenant_id}, ${src.default_group_id}, ${c.id}) on conflict do nothing`);

    const open = (await rows(t, sql`select id from leads where tenant_id = ${src.tenant_id} and contact_id = ${c.id} and status in ('new','contacted','qualified')`))[0];
    if (open) {
      await t.execute(sql`update leads set submissions = submissions + 1, fields = fields || ${JSON.stringify(lead.fields)}::jsonb, updated_at = now() where id = ${open.id}`);
      await t.execute(sql`insert into lead_events (tenant_id, lead_id, kind, data) values (${src.tenant_id}, ${open.id}, 'resubmitted', ${JSON.stringify({ source: src.name, utm: lead.utm })}::jsonb)`);
      out = { status: 200, leadId: open.id, created: false, consent: consentNow };
    } else {
      // Round robin over assignees that are still members of the workspace.
      const ids: string[] = src.assign_user_ids ?? [];
      let owner: string | null = null;
      if (ids.length) {
        const valid = (await rows(t, sql`select user_id from tenant_members where tenant_id = ${src.tenant_id} and user_id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`)).map((r) => r.user_id as string);
        const pool = ids.filter((i) => valid.includes(i));
        if (pool.length) owner = pool[Number(src.rr_cursor) % pool.length]!;
      }
      const l = (await rows(t, sql`insert into leads (tenant_id, source_id, contact_id, owner_user_id, utm, source_url, fields)
        values (${src.tenant_id}, ${src.id}, ${c.id}, ${owner}, ${JSON.stringify(lead.utm)}::jsonb, ${lead.sourceUrl}, ${JSON.stringify(lead.fields)}::jsonb) returning id`))[0]!;
      await t.execute(sql`insert into lead_events (tenant_id, lead_id, kind, data) values (${src.tenant_id}, ${l.id}, 'created', ${JSON.stringify({ source: src.name, kind: src.kind, newContact: createdContact, owner })}::jsonb)`);
      if (owner) await t.execute(sql`insert into lead_events (tenant_id, lead_id, kind, data) values (${src.tenant_id}, ${l.id}, 'assigned', ${JSON.stringify({ to: owner, how: 'round_robin' })}::jsonb)`);
      out = { status: 200, leadId: l.id, created: true, consent: consentNow };
    }
    await t.execute(sql`update lead_sources set lead_count = lead_count + ${out.status === 200 && out.created ? 1 : 0}, rr_cursor = rr_cursor + ${out.status === 200 && out.created ? 1 : 0}, last_lead_at = now() where id = ${src.id}`);
  });

  if (overLimit) { await reject('plan_full', `Plan allows ${limit} contacts.`); return { status: 402, error: 'Contact limit of the plan reached.' }; }
  return out;
}

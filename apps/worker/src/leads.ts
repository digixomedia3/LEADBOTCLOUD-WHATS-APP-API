import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';
import { decideConsent, extractLead, parseBody, phoneFromLead, planLimits, type ConsentMode, type ExtractedLead } from '@lbc/shared';

type Row = Record<string, any>;
const rows = async (db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];
/** text[] from a JS array without relying on driver array binding. */
const textArr = (a: string[]) => sql`(select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(a)}::jsonb) x)`;

export const hashSecret = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export type LeadResult =
  | { status: 200; leadId: string; created: boolean; consent: 'allowed' | 'unknown' | 'stopped'; duplicate?: boolean }
  | { status: 400 | 401 | 402 | 403 | 404 | 413 | 422; error: string };

const MAX_BODY = 64 * 1024;

/** Looks up the source, checks the key and the on/off switch. Everything public goes through here first. */
export async function ingestLead(db: Db, publicId: string, secret: string | undefined, raw: Buffer, contentType: string | undefined): Promise<LeadResult> {
  const src = (await rows(db, sql`select * from lead_sources where public_id = ${publicId}`))[0];
  if (!src) return { status: 404, error: 'Unknown lead source.' };
  // A source with no key is fed by something else (a hosted form, a WhatsApp ad click, an OAuth connection, an import). It must never accept posts from the open internet.
  if (!src.secret_hash) return { status: 404, error: 'Unknown lead source.' };
  if (!secret || !safeEq(hashSecret(secret), src.secret_hash)) return { status: 401, error: 'Wrong or missing key.' };
  if (!src.enabled) return { status: 403, error: 'This lead source is switched off.' };
  return ingestForSource(db, src, raw, contentType);
}

/** Refusals after the source is proven are recorded in lead_rejects so the owner can see why leads are missing. */
async function reject(db: Db, src: Row, reason: string, detail: string, sample?: unknown) {
  await db.execute(sql`insert into lead_rejects (tenant_id, source_id, reason, detail, sample) values (${src.tenant_id}, ${src.id}, ${reason}, ${detail.slice(0, 300)}, ${sample === undefined ? null : JSON.stringify(sample).slice(0, 2000)}::jsonb)`);
}

export async function ingestForSource(db: Db, src: Row, raw: Buffer, contentType: string | undefined): Promise<LeadResult> {
  if (raw.length > MAX_BODY) { await reject(db, src, 'too_large', `${raw.length} bytes`); return { status: 413, error: 'Payload too large.' }; }
  const body = parseBody(raw.toString('utf8'), contentType);
  if (body === null) { await reject(db, src, 'unreadable', 'Body was not JSON or form data.'); return { status: 400, error: 'Send JSON or form data.' }; }
  const lead = extractLead(body, (src.field_map ?? {}) as Record<string, string>);
  const phone = phoneFromLead(lead);
  if (!phone.ok) { await reject(db, src, 'invalid_phone', phone.reason, { fields: Object.keys(lead.fields).slice(0, 12), phone: lead.phone ? String(lead.phone).slice(0, 4) + '…' : null }); return { status: 422, error: phone.reason }; }
  return recordLead(db, src, lead, phone.e164);
}

/**
 * The core: given a proven source and a normalised lead, create or update the contact, record consent honestly, and create or extend the lead.
 * Used by the keyed endpoint, hosted forms and WhatsApp ad clicks, so the rules (never override STOP, one open lead per person, plan limits) hold everywhere.
 */
export async function recordLead(db: Db, src: Row, lead: ExtractedLead, e164: string): Promise<LeadResult> {
  const decision = decideConsent(src.consent_mode as ConsentMode, lead);
  const tenant = (await rows(db, sql`select plan_id from tenants where id = ${src.tenant_id}`))[0];
  const limit = planLimits(tenant?.plan_id ?? 'free').contacts;

  let out: LeadResult = { status: 422, error: 'unreachable' };
  let overLimit = false;
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // A platform retry (same lead id) must change nothing. Claiming the id first makes concurrent retries safe too.
    if (lead.externalId) {
      const claim = await rows(t, sql`insert into lead_external_ids (source_id, external_id, tenant_id) values (${src.id}, ${lead.externalId}, ${src.tenant_id}) on conflict do nothing returning external_id`);
      if (!claim[0]) {
        const prev = (await rows(t, sql`select lead_id from lead_external_ids where source_id = ${src.id} and external_id = ${lead.externalId}`))[0];
        out = { status: 200, leadId: String(prev?.lead_id ?? ''), created: false, consent: 'unknown', duplicate: true };
        return;
      }
    }
    let c = (await rows(t, sql`select id, consent_status, name, email from contacts where tenant_id = ${src.tenant_id} and phone_e164 = ${e164} for update`))[0];
    let createdContact = false;
    if (!c) {
      const n = Number((await rows(t, sql`select count(*)::int as n from contacts where tenant_id = ${src.tenant_id}`))[0]!.n);
      if (n >= limit) { overLimit = true; throw new Error('__over_limit__'); }
      const grant = decision.status === 'allowed';
      // Two simultaneous first posts can both get here; the unique index decides, and the loser reads the winner's row.
      c = (await rows(t, sql`insert into contacts (tenant_id, phone_e164, name, email, tags, consent_status, consent_source, consent_at, attributes)
        values (${src.tenant_id}, ${e164}, ${lead.name}, ${lead.email}, ${textArr([...new Set([...(src.default_tags ?? []), ...lead.tags])])}, ${grant ? 'allowed' : 'unknown'}, ${grant ? decision.source : null}, ${grant ? sql`now()` : null}, '{}'::jsonb)
        on conflict (tenant_id, phone_e164) do nothing returning id, consent_status`))[0];
      if (!c) c = (await rows(t, sql`select id, consent_status, name, email from contacts where tenant_id = ${src.tenant_id} and phone_e164 = ${e164} for update`))[0]!;
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
    const consentNow = (await rows(t, sql`select consent_status from contacts where id = ${c!.id}`))[0]!.consent_status as 'allowed' | 'unknown' | 'stopped';
    if (src.default_group_id) await t.execute(sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${src.tenant_id}, ${src.default_group_id}, ${c!.id}) on conflict do nothing`);

    const open = (await rows(t, sql`select id from leads where tenant_id = ${src.tenant_id} and contact_id = ${c!.id} and status in ('new','contacted','qualified')`))[0];
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
        values (${src.tenant_id}, ${src.id}, ${c!.id}, ${owner}, ${JSON.stringify(lead.utm)}::jsonb, ${lead.sourceUrl}, ${JSON.stringify(lead.fields)}::jsonb) returning id`))[0]!;
      await t.execute(sql`insert into lead_events (tenant_id, lead_id, kind, data) values (${src.tenant_id}, ${l.id}, 'created', ${JSON.stringify({ source: src.name, kind: src.kind, newContact: createdContact, owner })}::jsonb)`);
      if (owner) await t.execute(sql`insert into lead_events (tenant_id, lead_id, kind, data) values (${src.tenant_id}, ${l.id}, 'assigned', ${JSON.stringify({ to: owner, how: 'round_robin' })}::jsonb)`);
      out = { status: 200, leadId: l.id, created: true, consent: consentNow };
    }
    if (lead.externalId && out.status === 200) await t.execute(sql`update lead_external_ids set lead_id = ${out.leadId} where source_id = ${src.id} and external_id = ${lead.externalId}`);
    await t.execute(sql`update lead_sources set lead_count = lead_count + ${out.status === 200 && out.created ? 1 : 0}, rr_cursor = rr_cursor + ${out.status === 200 && out.created ? 1 : 0}, last_lead_at = now() where id = ${src.id}`);
  }).catch((e: Error) => { if (e.message !== '__over_limit__') throw e; });

  if (overLimit) { await reject(db, src, 'plan_full', `Plan allows ${limit} contacts.`); return { status: 402, error: 'Contact limit of the plan reached.' }; }
  return out;
}

/** Hosted form submission. The slug is the only credential, so the form must be on, bots are caught by a hidden field, and the source rules still apply. */
export async function submitForm(db: Db, slug: string, raw: Buffer, contentType: string | undefined): Promise<LeadResult> {
  const f = (await rows(db, sql`select f.*, row_to_json(s.*) as src from lead_forms f join lead_sources s on s.id = f.source_id where f.slug = ${slug}`))[0];
  if (!f || !f.enabled) return { status: 404, error: 'This form is not available.' };
  const src = f.src as Row;
  if (!src.enabled) return { status: 403, error: 'This form is switched off.' };
  const body = parseBody(raw.toString('utf8'), contentType);
  // The hidden "website" field is invisible to people; anything that fills it is a bot. Pretend success so it learns nothing.
  if (body && typeof body === 'object' && String((body as Record<string, unknown>).website ?? '').trim() !== '') return { status: 200, leadId: '', created: false, consent: 'unknown' };
  const r = await ingestForSource(db, src, raw, contentType);
  if (r.status === 200 && r.created) await db.execute(sql`update lead_forms set submit_count = submit_count + 1 where id = ${f.id}`);
  return r;
}

/**
 * A customer wrote to the business from a Click-to-WhatsApp ad. Records the ad on the conversation and creates or extends a lead under the
 * workspace's system "WhatsApp ads" source. Messaging first is NOT marketing consent, so the contact stays reply-only.
 */
export async function recordAdClick(db: Db, tenantId: string, contactId: string, convId: string, e164: string, name: string | null, ref: Record<string, unknown>): Promise<void> {
  const s = (v: unknown, n = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  const clid = s(ref.ctwa_clid, 400), adId = s(ref.source_id, 80), headline = s(ref.headline, 200), url = s(ref.source_url, 500);
  await db.execute(sql`update conversations set ctwa_clid = coalesce(${clid}, ctwa_clid), referral = ${JSON.stringify({ source_id: adId, source_type: s(ref.source_type, 20), headline, body: s(ref.body, 300), source_url: url, media_type: s(ref.media_type, 20) })}::jsonb where id = ${convId} and tenant_id = ${tenantId}`);
  await db.execute(sql`insert into lead_sources (tenant_id, kind, name, public_id, secret_hash, consent_mode, default_tags)
    values (${tenantId}, 'ctwa', 'WhatsApp ads', ${'ctwa_' + tenantId.replace(/-/g, '').slice(0, 18)}, null, 'none', ${textArr(['ctwa'])}) on conflict do nothing`);
  const src = (await rows(db, sql`select * from lead_sources where tenant_id = ${tenantId} and kind = 'ctwa'`))[0];
  if (!src || !src.enabled) return;
  const fields: Record<string, string> = {};
  if (adId) fields.ad_id = adId; if (headline) fields.ad_headline = headline; if (s(ref.body, 300)) fields.ad_text = s(ref.body, 300)!;
  const lead: ExtractedLead = { phone: e164, altPhones: [], externalId: null, name, email: null, consentGiven: false, utm: { utm_source: 'ctwa', ...(clid ? { ctwa_clid: clid } : {}) }, sourceUrl: url, fields, tags: [] };
  await recordLead(db, src, lead, e164);
}

export class ImportSourceNotFound extends Error { constructor() { super('import source not found'); } }

export interface ImportRow { line: number; name?: string; phone: string; email?: string; extra?: Record<string, string> }
export interface ImportReport { added: number; extended: number; invalid: number; overLimit: number; errors: { line: number; reason: string }[] }

/**
 * Spreadsheet import. Every row takes the same road as a live lead (recordLead), so STOP is never overridden, duplicates extend the open lead, and the plan
 * limit applies. The source decides consent: reply-only unless the owner confirmed (and the web app recorded who and when) that these people agreed.
 */
export async function importLeads(db: Db, tenantId: string, sourceId: string, input: ImportRow[]): Promise<ImportReport> {
  const src = (await rows(db, sql`select * from lead_sources where id = ${sourceId} and tenant_id = ${tenantId} and kind = 'import'`))[0];
  if (!src) throw new ImportSourceNotFound();
  const rep: ImportReport = { added: 0, extended: 0, invalid: 0, overLimit: 0, errors: [] };
  const err = (line: number, reason: string) => { if (rep.errors.length < 100) rep.errors.push({ line, reason }); };
  const seen = new Set<string>();
  for (const r of input.slice(0, 5000)) {
    const ph = phoneFromLead({ phone: String(r.phone ?? ''), altPhones: [] });
    if (!ph.ok) { rep.invalid++; err(r.line, ph.reason); continue; }
    if (seen.has(ph.e164)) { rep.invalid++; err(r.line, 'Same number appears earlier in the file.'); continue; }
    seen.add(ph.e164);
    const email = r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) ? r.email.toLowerCase().slice(0, 254) : null;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.extra ?? {})) if (typeof v === 'string' && v.trim() && Object.keys(fields).length < 40) fields[k.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)] = v.trim().slice(0, 500);
    const lead: ExtractedLead = { phone: ph.e164, altPhones: [], externalId: null, name: r.name?.trim().slice(0, 120) || null, email, consentGiven: true, utm: {}, sourceUrl: null, fields, tags: [] };
    const res = await recordLead(db, src, lead, ph.e164);
    if (res.status === 200) { if (res.created) rep.added++; else rep.extended++; }
    else if (res.status === 402) { rep.overLimit++; err(r.line, 'Your plan’s contact limit was reached.'); }
    else { rep.invalid++; err(r.line, 'error' in res ? res.error : 'Could not import this row.'); }
  }
  return rep;
}

/**
 * Lead capture helpers (pure, no database). One job: turn whatever a platform posts into a clean lead, and decide consent.
 * Platforms disagree on field names, nesting and encoding (Zapier sends flat JSON, Facebook Lead Ads sends field_data arrays,
 * website forms send urlencoded), so this is deliberately forgiving about SHAPE and strict about MEANING: a phone must be a real number,
 * and a lead is never treated as WhatsApp marketing consent unless the source says so on the record.
 */
import { normalizePhone } from './phone';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'junk'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const OPEN_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified'];

export const CONSENT_MODES = ['none', 'field', 'attested'] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];

export const LEAD_SOURCE_KINDS = ['webhook', 'form', 'widget', 'import', 'manual', 'meta_lead_ads', 'ctwa', 'shopify', 'woocommerce', 'google_sheets', 'hubspot', 'zoho', 'indiamart', 'justdial', 'other'] as const;

export interface ExtractedLead {
  phone: string | null;
  name: string | null;
  email: string | null;
  /** The payload explicitly said yes to WhatsApp messages (a checkbox or consent field). Absence is NOT consent. */
  consentGiven: boolean;
  utm: Record<string, string>;
  sourceUrl: string | null;
  /** Everything else the form collected, flattened to short strings. Capped so one bad post cannot bloat the database. */
  fields: Record<string, string>;
  tags: string[];
}

const PHONE_KEYS = ['phone', 'phone_number', 'phonenumber', 'mobile', 'mobile_number', 'mobileno', 'whatsapp', 'whatsapp_number', 'whatsapp_no', 'contact', 'contact_number', 'contact_no', 'cell', 'tel', 'telephone', 'sender_mobile', 'mobile_no'];
const NAME_KEYS = ['name', 'full_name', 'fullname', 'customer_name', 'your_name', 'contact_name', 'sender_name', 'lead_name'];
const FIRST_KEYS = ['first_name', 'firstname', 'fname', 'given_name'];
const LAST_KEYS = ['last_name', 'lastname', 'lname', 'surname', 'family_name'];
const EMAIL_KEYS = ['email', 'email_address', 'mail', 'e_mail', 'sender_email'];
const CONSENT_KEYS = ['whatsapp_consent', 'whatsapp_optin', 'whatsapp_opt_in', 'consent', 'opt_in', 'optin', 'agree', 'agreed', 'accept_whatsapp', 'allow_whatsapp', 'marketing_consent'];
const URL_KEYS = ['page_url', 'source_url', 'url', 'landing_page', 'referrer_url'];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ctwa_clid'];

/** "Phone Number", "phone-number", "phoneNumber" and "PHONE_NUMBER" all become phone_number. */
export const normKey = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const TRUE = new Set(['true', 'yes', 'y', '1', 'on', 'checked', 'agree', 'agreed', 'accept', 'accepted', 'opt_in', 'optin', 'i_agree', 'allow']);
export const isTruthy = (v: unknown): boolean => v === true || v === 1 || (typeof v === 'string' && TRUE.has(v.trim().toLowerCase().replace(/[\s-]+/g, '_')));

const MAX_FIELDS = 40, MAX_VALUE = 500;

/** Flattens nested objects and Facebook-style field_data arrays into one level of short strings with normalised keys. */
export function flatten(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    const key = normKey(k); if (!key || key in out || Object.keys(out).length >= MAX_FIELDS * 3) return;
    if (v === null || v === undefined) return;
    const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
    if (s !== null && s.trim() !== '') out[key] = s.trim().slice(0, MAX_VALUE);
  };
  const walk = (o: unknown, prefix: string, depth: number) => {
    if (depth > 4 || o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      for (const item of o) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const it = item as Record<string, unknown>;
          // Facebook / Google style: [{ name: 'phone_number', values: ['+91...'] }]  or  [{ column_id, string_value }]
          const nm = (it.name ?? it.column_id ?? it.key ?? it.field) as unknown;
          const val = it.values !== undefined ? (Array.isArray(it.values) ? it.values[0] : it.values) : (it.value ?? it.string_value ?? it.answer);
          // Pair arrays are containers (field_data, answers...), so the entry keeps its own name; a name clash keeps the first value.
          if (typeof nm === 'string' && val !== undefined && typeof val !== 'object') { put(nm, val); continue; }
        }
        walk(item, prefix, depth + 1);
      }
      return;
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v !== null && typeof v === 'object') walk(v, prefix ? `${prefix}_${normKey(k)}` : normKey(k), depth + 1);
      else put(prefix ? `${prefix}_${k}` : k, v);
    }
  };
  walk(input, '', 0);
  return out;
}

/** Parses a request body that is JSON or application/x-www-form-urlencoded. Returns null when it is neither. */
export function parseBody(raw: string, contentType: string | undefined): unknown {
  const ct = (contentType ?? '').toLowerCase();
  const t = raw.trim();
  if (!t) return null;
  if (ct.includes('json') || t.startsWith('{') || t.startsWith('[')) { try { return JSON.parse(t); } catch { return null; } }
  if (ct.includes('x-www-form-urlencoded') || /^[^=&\s]+=/.test(t)) {
    const o: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(t)) if (!(k in o)) o[k] = v;
    return o;
  }
  return null;
}

const firstOf = (flat: Record<string, string>, keys: string[], custom?: string) => {
  if (custom) { const v = flat[normKey(custom)]; if (v) return v; }
  for (const k of keys) if (flat[k]) return flat[k]!;
  return null;
};

/** `map` lets a source override a field: { phone: 'Contact No', name: 'Customer' } where values are the platform's own field names. */
export function extractLead(body: unknown, map: Partial<Record<'phone' | 'name' | 'email' | 'consent', string>> = {}): ExtractedLead {
  const flat = flatten(body);
  const used = new Set<string>();
  const take = (keys: string[], custom?: string) => {
    if (custom && flat[normKey(custom)]) { used.add(normKey(custom)); return flat[normKey(custom)]!; }
    for (const k of keys) if (flat[k]) { used.add(k); return flat[k]!; }
    return null;
  };
  const phone = take(PHONE_KEYS, map.phone);
  let name = take(NAME_KEYS, map.name);
  if (!name) { const f = take(FIRST_KEYS), l = take(LAST_KEYS); name = [f, l].filter(Boolean).join(' ') || null; }
  const email = take(EMAIL_KEYS, map.email);
  const emailOk = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email.toLowerCase() : null;
  const consentRaw = take(CONSENT_KEYS, map.consent);
  const sourceUrl = take(URL_KEYS);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) if (flat[k]) { utm[k] = flat[k]!.slice(0, 200); used.add(k); }
  const tags = (flat.tags ?? flat.tag ?? '').split(',').map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 10);
  if (flat.tags) used.add('tags'); if (flat.tag) used.add('tag');
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(flat)) { if (!used.has(k) && Object.keys(fields).length < MAX_FIELDS) fields[k] = v; }
  return { phone, name: name ? name.slice(0, 120) : null, email: emailOk, consentGiven: consentRaw !== null && isTruthy(consentRaw), utm, sourceUrl: sourceUrl ? sourceUrl.slice(0, 500) : null, fields, tags };
}

export interface ConsentDecision {
  /** 'allowed' grants marketing consent; 'unknown' means reply-only (no marketing sends). Never 'stopped': a lead cannot opt anyone out or in over a STOP. */
  status: 'allowed' | 'unknown';
  source: string | null;
  reason: string;
}

/**
 * The rule that keeps the platform out of trouble: a lead is only marketing-consented if the source says so explicitly.
 *  - none:     never (the lead can still be replied to inside the 24-hour window if they message first).
 *  - field:    only when THIS submission carries a truthy consent field (a ticked checkbox).
 *  - attested: the owner has recorded that this form shows a clear WhatsApp opt-in; every submission counts.
 */
export function decideConsent(mode: ConsentMode, lead: Pick<ExtractedLead, 'consentGiven'>): ConsentDecision {
  if (mode === 'attested') return { status: 'allowed', source: 'Website form', reason: 'source_attested' };
  if (mode === 'field' && lead.consentGiven) return { status: 'allowed', source: 'Website form', reason: 'consent_field' };
  if (mode === 'field') return { status: 'unknown', source: null, reason: 'consent_field_missing' };
  return { status: 'unknown', source: null, reason: 'source_does_not_collect_consent' };
}

/** Token bucket per key, in memory: `limit` events per `windowMs`. Good enough per process to stop a runaway form or a flood. */
export function makeLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now(), from = t - windowMs;
    const arr = (hits.get(key) ?? []).filter((x) => x > from);
    if (arr.length >= limit) { hits.set(key, arr); return false; }
    arr.push(t); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (v[v.length - 1]! <= from) hits.delete(k);
    return true;
  };
}

export function phoneFromLead(l: Pick<ExtractedLead, 'phone'>): { ok: true; e164: string } | { ok: false; reason: string } {
  if (!l.phone) return { ok: false, reason: 'No phone number found in the submission.' };
  return normalizePhone(l.phone);
}

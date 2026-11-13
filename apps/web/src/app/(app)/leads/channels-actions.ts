'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { z } from 'zod';
import { normalizePhone } from '@lbc/shared';
import { signInternal } from '@lbc/shared/internal-sign';
import { Forbidden, assertRole, db, requireCtx, type Ctx } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, q: ReturnType<typeof sql>) => (await tx.execute(q)) as Row[];

async function guard(): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, 'admin'); } catch (e) { if (e instanceof Forbidden) return { error: 'Your role cannot do this. Ask the workspace owner.' }; throw e; }
  return { ctx };
}

const appBase = () => (process.env.APP_URL ?? '').trim().replace(/\/+$/, '');

export interface FormRow {
  id: string; sourceId: string; slug: string; title: string; intro: string | null; buttonText: string; thankYou: string; askEmail: boolean;
  extraFields: { key: string; label: string; required?: boolean }[]; consentText: string | null; accent: string; enabled: boolean;
  views: number; submits: number; url: string; sourceName: string; consentMode: string;
}

export async function listForms(): Promise<{ forms: FormRow[]; base: string }> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const r = await rows(tx, sql`select f.*, s.name as source_name, s.consent_mode from lead_forms f join lead_sources s on s.id = f.source_id order by f.created_at desc`);
    return {
      base: appBase(),
      forms: r.map((x) => ({ id: x.id, sourceId: x.source_id, slug: x.slug, title: x.title, intro: x.intro, buttonText: x.button_text, thankYou: x.thank_you, askEmail: x.ask_email, extraFields: x.extra_fields ?? [], consentText: x.consent_text, accent: x.accent, enabled: x.enabled, views: x.view_count, submits: x.submit_count, url: `${appBase()}/f/${x.slug}`, sourceName: x.source_name, consentMode: x.consent_mode })),
    };
  });
}

const formSchema = z.object({
  title: z.string().trim().min(2, 'Give the form a title.').max(80),
  intro: z.string().trim().max(300).nullable().default(null),
  buttonText: z.string().trim().min(1).max(30).default('Send'),
  thankYou: z.string().trim().min(2).max(200).default('Thank you! We will message you on WhatsApp shortly.'),
  askEmail: z.boolean().default(false),
  extraFields: z.array(z.object({ label: z.string().trim().min(1, 'Name every extra question.').max(60), required: z.boolean().default(false) })).max(6, 'You can add up to 6 extra questions.').default([]),
  // With wording, the box appears and ticking it grants offers. Without wording there is no box and the source stays reply-only.
  consentText: z.string().trim().min(15, 'Write the full sentence people agree to, for example “I agree to receive WhatsApp messages and offers from us.”').max(300).nullable().default(null),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour.').default('#10b981'),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  assignUserIds: z.array(z.string()).max(20).default([]),
  groupId: z.string().uuid().nullable().default(null),
});
export type FormInput = z.input<typeof formSchema>;

/** Field keys for custom questions: stable, safe, unique, and never able to collide with the ones we read ourselves. */
const RESERVED = new Set(['name', 'phone', 'email', 'website', 'whatsapp_consent', 'page_url', 'tags']);
function keyFor(label: string, taken: Set<string>): string {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'question';
  if (RESERVED.has(base)) base = `q_${base}`;
  let k = base, i = 2; while (taken.has(k)) k = `${base}_${i++}`;
  taken.add(k); return k;
}

export async function createForm(input: FormInput): Promise<Result<{ id: string; url: string }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const p = formSchema.safeParse(input); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  const slug = `${p.data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'form'}-${randomBytes(4).toString('hex')}`.replace(/^-/, 'f');
  const taken = new Set<string>(); const extra = p.data.extraFields.map((f) => ({ key: keyFor(f.label, taken), label: f.label, required: f.required }));
  return db(g.ctx, async (tx) => {
    if (p.data.groupId && !(await rows(tx, sql`select 1 from contact_groups where id = ${p.data.groupId}`)).length) return fail('That group does not exist.');
    if (p.data.assignUserIds.length) {
      const ok = await rows(tx, sql`select user_id from tenant_members where user_id in (select jsonb_array_elements_text(${JSON.stringify(p.data.assignUserIds)}::jsonb))`);
      if (ok.length !== new Set(p.data.assignUserIds).size) return fail('Only members of this workspace can be assigned leads.');
    }
    const mode = p.data.consentText ? 'field' : 'none';
    const publicId = 'src_' + randomBytes(9).toString('base64url');
    const tagArr = sql`(select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(['form', ...p.data.tags])}::jsonb) x)`;
    const assignArr = sql`(select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(p.data.assignUserIds)}::jsonb) x)`;
    // The form's own source has no key (the page is public by design); everything else about it works like any source.
    const s = (await rows(tx, sql`insert into lead_sources (tenant_id, kind, name, public_id, secret_hash, consent_mode, default_tags, assign_user_ids, default_group_id)
      values (${g.ctx.tenantId}, 'form', ${'Form: ' + p.data.title}, ${publicId}, null, ${mode}, ${tagArr}, ${assignArr}, ${p.data.groupId}) returning id`))[0]!;
    const f = (await rows(tx, sql`insert into lead_forms (tenant_id, source_id, slug, title, intro, button_text, thank_you, ask_email, extra_fields, consent_text, accent)
      values (${g.ctx.tenantId}, ${s.id}, ${slug}, ${p.data.title}, ${p.data.intro}, ${p.data.buttonText}, ${p.data.thankYou}, ${p.data.askEmail}, ${JSON.stringify(extra)}::jsonb, ${p.data.consentText}, ${p.data.accent}) returning id`))[0]!;
    await tx.execute(sql`select public.write_audit('lead_form.created', 'lead_form', ${f.id as string}, ${JSON.stringify({ title: p.data.title, consent: mode })}::jsonb)`);
    revalidatePath('/leads');
    return { ok: true as const, data: { id: f.id as string, url: `${appBase()}/f/${slug}` } };
  });
}

export async function updateForm(id: string, input: FormInput): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const p = formSchema.safeParse(input); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  return db(g.ctx, async (tx) => {
    const cur = (await rows(tx, sql`select source_id, extra_fields from lead_forms where id = ${id}`))[0];
    if (!cur) return fail('Form not found.');
    // Keep the key of a question that still exists (matched by label) so old answers stay under the same name.
    const old: { key: string; label: string }[] = cur.extra_fields ?? [];
    const taken = new Set<string>(); const extra = p.data.extraFields.map((f) => { const same = old.find((o) => o.label.toLowerCase() === f.label.toLowerCase() && !taken.has(o.key)); if (same) { taken.add(same.key); return { key: same.key, label: f.label, required: f.required }; } return { key: '', label: f.label, required: f.required }; })
      .map((f) => (f.key ? f : { ...f, key: keyFor(f.label, taken) }));
    const mode = p.data.consentText ? 'field' : 'none';
    await tx.execute(sql`update lead_forms set title = ${p.data.title}, intro = ${p.data.intro}, button_text = ${p.data.buttonText}, thank_you = ${p.data.thankYou}, ask_email = ${p.data.askEmail},
      extra_fields = ${JSON.stringify(extra)}::jsonb, consent_text = ${p.data.consentText}, accent = ${p.data.accent}, updated_at = now() where id = ${id}`);
    await tx.execute(sql`update lead_sources set name = ${'Form: ' + p.data.title}, consent_mode = ${mode}, default_group_id = ${p.data.groupId},
      default_tags = (select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(['form', ...p.data.tags])}::jsonb) x),
      assign_user_ids = (select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify(p.data.assignUserIds)}::jsonb) x), updated_at = now() where id = ${cur.source_id}`);
    await tx.execute(sql`select public.write_audit('lead_form.updated', 'lead_form', ${id}, ${JSON.stringify({ consent: mode })}::jsonb)`);
    revalidatePath('/leads');
    return { ok: true as const, data: null };
  });
}

export async function setFormEnabled(id: string, enabled: boolean): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const r = await rows(tx, sql`update lead_forms set enabled = ${enabled}, updated_at = now() where id = ${id} returning id`);
    if (!r.length) return fail('Form not found.');
    await tx.execute(sql`select public.write_audit(${enabled ? 'lead_form.enabled' : 'lead_form.disabled'}, 'lead_form', ${id}, null)`);
    revalidatePath('/leads');
    return { ok: true as const, data: null };
  });
}

/** Deleting a form removes its source too; leads and contacts it produced are kept. */
export async function deleteForm(id: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const r = await rows(tx, sql`select source_id from lead_forms where id = ${id}`);
    if (!r.length) return fail('Form not found.');
    await tx.execute(sql`delete from lead_sources where id = ${r[0]!.source_id}`);
    await tx.execute(sql`select public.write_audit('lead_form.deleted', 'lead_form', ${id}, null)`);
    revalidatePath('/leads');
    return { ok: true as const, data: null };
  });
}

/* ------------------------------------------------------------------ QR codes and wa.me links */
const qrOpts = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } };

/** SVG QR for a link we built. Only http(s) links on our own app address or wa.me are encoded, so this can't be used as a free QR service for anything. */
export async function qrFor(target: string): Promise<Result<{ svg: string }>> {
  const ctx = await requireCtx(); void ctx;
  let u: URL; try { u = new URL(target); } catch { return fail('That is not a valid link.'); }
  const base = appBase() ? new URL(appBase()).host : null;
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('Only web links can be turned into a QR code.');
  if (u.host !== 'wa.me' && (!base || u.host !== base)) return fail('QR codes can be made for your forms and WhatsApp links only.');
  if (target.length > 600) return fail('That link is too long for a QR code.');
  return { ok: true, data: { svg: await QRCode.toString(target, { ...qrOpts, type: 'svg' }) } };
}

const waSchema = z.object({ phone: z.string().trim().min(5), message: z.string().trim().max(300).default(''), tag: z.string().trim().max(40).default('') });
/** A click-to-chat link with a pre-filled message. A tag in the message lets the team see which poster, flyer or shop counter brought the chat. */
export async function whatsappLink(input: z.input<typeof waSchema>): Promise<Result<{ url: string }>> {
  await requireCtx();
  const p = waSchema.safeParse(input); if (!p.success) return fail('Enter your WhatsApp number.');
  const n = normalizePhone(p.data.phone); if (!n.ok) return fail(n.reason);
  const text = [p.data.message, p.data.tag ? `[${p.data.tag}]` : ''].filter(Boolean).join(' ');
  return { ok: true, data: { url: `https://wa.me/${n.e164.slice(1)}${text ? `?text=${encodeURIComponent(text)}` : ''}` } };
}

/** Embeddable floating WhatsApp button for any website. Pure HTML + a few lines of script; nothing is loaded from us, so it cannot break the site. */
export async function widgetSnippet(input: { phone: string; message: string; label: string; position: 'right' | 'left'; color: string }): Promise<Result<{ code: string }>> {
  await requireCtx();
  const n = normalizePhone(input.phone); if (!n.ok) return fail(n.reason);
  if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) return fail('Pick a valid colour.');
  const esc = (s: string) => s.replace(/[<>"'&\\]/g, '').slice(0, 120);
  const label = esc(input.label) || 'Chat with us';
  const side = input.position === 'left' ? 'left' : 'right';
  const msg = esc(input.message);
  const code = `<!-- WhatsApp button -->
<a id="lbc-wa" href="#" target="_blank" rel="noopener" aria-label="${label}"
   style="position:fixed;${side}:16px;bottom:16px;z-index:99999;display:flex;align-items:center;gap:8px;padding:12px 18px;border-radius:999px;background:${input.color};color:#fff;font:600 15px/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.25)">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l1.9.9c.3.1.4.2.5.3.1.1.1.6-.1 1.2z"/></svg>${label}</a>
<script>
(function () {
  var a = document.getElementById('lbc-wa'), q = new URLSearchParams(location.search), tags = [];
  ['utm_source', 'utm_campaign', 'gclid', 'fbclid'].forEach(function (k) { if (q.get(k)) tags.push(k.replace('utm_', '') + ':' + q.get(k).slice(0, 20)); });
  var text = ${JSON.stringify(msg)} + (tags.length ? ' [' + tags.join(' ') + ']' : '');
  a.href = 'https://wa.me/${n.e164.slice(1)}' + (text.trim() ? '?text=' + encodeURIComponent(text.trim()) : '');
})();
</script>`;
  return { ok: true, data: { code } };
}

/* ------------------------------------------------------------------ CSV import of leads */
export interface LeadImportRow { line: number; name: string; phone: string; email: string; extra: Record<string, string> }
export interface LeadImportReport { added: number; extended: number; invalid: number; overLimit: number; errors: { line: number; reason: string }[] }

/** Imports leads from a spreadsheet the owner uploaded. These people are reply-only unless the owner confirms they agreed, which is recorded with who and when. */
export async function importLeads(input: { rows: LeadImportRow[]; sourceName: string; consent: boolean }): Promise<Result<LeadImportReport>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  if (!input.rows.length) return fail('The file has no rows.');
  if (input.rows.length > 5000) return fail('Please import up to 5,000 leads at a time.');
  const base = (process.env.WORKER_INTERNAL_URL ?? process.env.WORKER_PUBLIC_URL ?? '').trim().replace(/\/+$/, ''), secret = process.env.INTERNAL_API_SECRET ?? '';
  if (!base || secret.length < 16) return fail('Lead import is not switched on for this installation yet.');
  const ctx = g.ctx;
  const sourceName = input.sourceName.trim().slice(0, 80) || 'Imported list';
  const sourceId = await db(ctx, async (tx) => {
    const att = input.consent;
    const publicId = 'src_' + randomBytes(9).toString('base64url');
    const s = (await rows(tx, sql`insert into lead_sources (tenant_id, kind, name, public_id, secret_hash, consent_mode, attested_by, attested_at, default_tags)
      values (${ctx.tenantId}, 'import', ${sourceName}, ${publicId}, null, ${att ? 'attested' : 'none'}, ${att ? ctx.user.id : null}, ${att ? sql`now()` : null}, ${sql`'{imported}'::text[]`}) returning id`))[0]!;
    await tx.execute(sql`select public.write_audit('lead_import.started', 'lead_source', ${s.id as string}, ${JSON.stringify({ rows: input.rows.length, consentConfirmed: att })}::jsonb)`);
    return s.id as string;
  });
  const body = JSON.stringify({ tenantId: ctx.tenantId, sourceId, rows: input.rows.map((r) => ({ line: r.line, name: r.name, phone: r.phone, email: r.email, extra: r.extra })) });
  const { ts, sig } = signInternal(secret, body);
  try {
    const res = await fetch(`${base}/internal/leads/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lbc-ts': ts, 'x-lbc-sig': sig }, body, signal: AbortSignal.timeout(120_000) });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; report?: LeadImportReport };
    if (!res.ok || !j.ok || !j.report) return fail('The import could not be completed. Nothing was lost; try again in a minute.');
    revalidatePath('/leads');
    return { ok: true, data: j.report };
  } catch { return fail('The import service did not respond. Try again in a minute.'); }
}

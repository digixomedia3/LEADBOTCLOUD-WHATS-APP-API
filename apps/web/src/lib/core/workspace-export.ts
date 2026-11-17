/**
 * Everything a workspace owner is entitled to take with them, as plain JSON: contacts (with permission records), chats with message text, templates,
 * campaigns (counts), leads, quick replies, journeys and invoices. Files are listed by name and size, not included (they can be 16 MB each).
 * Secrets are never in it: no WhatsApp token, no API key hashes, no password hashes.
 * Capped so one download cannot exhaust the server; if a section hits its cap, the file says so and how many were left out.
 */
import { sql } from 'drizzle-orm';
import { db, type ActorCtx } from '@/lib/tenant-db';

export const EXPORT_CAPS = { contacts: 50000, messages: 200000, leads: 50000, campaigns: 5000 } as const;
type Row = Record<string, unknown>;
const rows = (r: unknown) => r as Row[];
const iso = (v: unknown) => (v ? new Date(v as string | number | Date).toISOString() : null);

export async function buildWorkspaceExport(ctx: ActorCtx): Promise<{ name: string; file: Record<string, unknown>; counts: Record<string, number> }> {
  return db(ctx, async (tx) => {
    const q = async (s: ReturnType<typeof sql>) => rows(await tx.execute(s));
    const ws = (await q(sql`select name, legal_name, gstin, plan_id, created_at, timezone from tenants where id = ${ctx.tenantId}::uuid`))[0] ?? {};
    const total = async (table: string) => Number((await q(sql.raw(`select count(*)::int as n from "${table}"`)))[0]!.n);
    const contacts = await q(sql`select id, name, phone_e164, email, tags, consent_status, consent_source, consent_at, opt_out_at, created_at from contacts order by created_at limit ${EXPORT_CAPS.contacts}`);
    const messages = await q(sql`select m.conversation_id, m.direction, m.kind, m.body, m.status, m.created_at, m.sent_at from messages m order by m.created_at limit ${EXPORT_CAPS.messages}`);
    const convs = await q(sql`select c.id, c.contact_id, c.status, c.created_at from conversations c order by c.created_at`);
    const leads = await q(sql`select l.contact_id, l.status, l.value_paise, l.submissions, l.fields, l.note, l.created_at from leads l order by l.created_at limit ${EXPORT_CAPS.leads}`);
    const templates = await q(sql`select name, language, category, status, body, header_type, footer, buttons, created_at from templates order by created_at`);
    const campaigns = await q(sql`select name, status, counts, est_cost_paise, started_at, completed_at, created_at from campaigns order by created_at desc limit ${EXPORT_CAPS.campaigns}`);
    const quick = await q(sql`select shortcut, body from quick_replies order by shortcut`);
    const journeys = await q(sql`select name, status, trigger, steps, created_at from journeys order by created_at`);
    const invoices = await q(sql`select number, plan, total_paise, issued_at from invoices order by issued_at`);
    const files = await q(sql`select 'sent' as direction, file_name, kind, size_bytes, created_at from message_attachments union all select 'received', file_name, kind, size_bytes, created_at from inbound_media where state <> 'expired' order by created_at limit 5000`);
    const byConv = new Map<string, Row[]>();
    for (const m of messages) { const k = String(m.conversation_id); (byConv.get(k) ?? byConv.set(k, []).get(k)!).push({ direction: m.direction, kind: m.kind, text: m.body, status: m.status, at: iso(m.created_at) }); }
    const counts = { contacts: await total('contacts'), messages: await total('messages'), leads: await total('leads'), campaigns: await total('campaigns') };
    const left = { contacts: Math.max(0, counts.contacts - contacts.length), messages: Math.max(0, counts.messages - messages.length), leads: Math.max(0, counts.leads - leads.length), campaigns: Math.max(0, counts.campaigns - campaigns.length) };
    const file = {
      exportedAt: new Date().toISOString(), format: 'leadbotcloud-workspace-export-v1',
      workspace: { name: ws.name, legalName: ws.legal_name ?? null, gstin: ws.gstin ?? null, plan: ws.plan_id, timezone: ws.timezone, createdAt: iso(ws.created_at) },
      notice: Object.values(left).some((n) => n > 0) ? `Some sections hit the download limit. Not included: ${Object.entries(left).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')}. Ask support for a full copy.` : 'Complete.',
      contacts: contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone_e164, email: c.email, tags: c.tags, permission: c.consent_status, permissionSource: c.consent_source, permissionAt: iso(c.consent_at), optedOutAt: iso(c.opt_out_at), added: iso(c.created_at) })),
      chats: convs.filter((c) => byConv.has(String(c.id))).map((c) => ({ contactId: c.contact_id, status: c.status, messages: byConv.get(String(c.id)) })),
      leads: leads.map((l) => ({ contactId: l.contact_id, status: l.status, valueRupees: Number(l.value_paise) / 100, submissions: l.submissions, fields: l.fields, note: l.note, created: iso(l.created_at) })),
      templates, campaigns, quickReplies: quick, journeys,
      invoices: invoices.map((i) => ({ number: i.number, plan: i.plan, totalRupees: Number(i.total_paise) / 100, issued: iso(i.issued_at) })),
      files: files.map((f) => ({ direction: f.direction, name: f.file_name, kind: f.kind, bytes: f.size_bytes, at: iso(f.created_at) })),
    };
    return { name: String(ws.name ?? 'workspace'), file, counts };
  });
}

/**
 * Contact and read rules shared by the panel and the API for AI agents.
 * Consent is a legal fact about a real person, so adding someone as "agreed to messages" is never implied:
 * the caller must say they have it and where it came from, and that statement is stored with the contact and in the audit trail.
 */
import { count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contactConsentEvents, contactGroupMembers, contactGroups, contacts, templates } from '@lbc/db';
import { CONSENT_SOURCES, normalizePhone, planLimits } from '@lbc/shared';
import { auditAs, db, type ActorCtx } from '@/lib/tenant-db';
import { fail, type Result } from './campaigns';

export const addContactInput = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(1, 'Enter a phone number.'),
  email: z.string().trim().email('That email does not look right.').optional().or(z.literal('')),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  groupIds: z.array(z.string().uuid()).max(50).default([]),
  /** The caller confirms this person agreed to get WhatsApp messages. Without it nobody is added. */
  consent: z.boolean(),
  source: z.enum(CONSENT_SOURCES),
});
export type AddContactInput = z.input<typeof addContactInput>;

export async function addContactFor(ctx: ActorCtx, input: AddContactInput): Promise<Result<{ id: string; phone: string }>> {
  const p = addContactInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details and try again.');
  const phone = normalizePhone(p.data.phone);
  if (!phone.ok) return fail(phone.reason);
  if (!p.data.consent) return fail('Please confirm this customer agreed to get WhatsApp messages from you.');
  return db(ctx, async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(contacts);
    if (n >= planLimits(ctx.workspace.plan).contacts) return fail(`Your plan allows ${planLimits(ctx.workspace.plan).contacts.toLocaleString('en-IN')} contacts. Upgrade to add more.`);
    const exists = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone.e164));
    if (exists.length) return fail('This number is already in your contacts.');
    const [row] = await tx.insert(contacts).values({
      tenantId: ctx.tenantId, phoneE164: phone.e164, name: p.data.name || null, email: p.data.email || null, tags: [...new Set(p.data.tags)],
      consentStatus: 'allowed', consentSource: p.data.source, consentAt: new Date(),
    }).returning({ id: contacts.id });
    await tx.insert(contactConsentEvents).values({ tenantId: ctx.tenantId, contactId: row!.id, action: 'opt_in', source: p.data.source, actorUserId: ctx.user.id });
    if (p.data.groupIds.length) {
      const valid = await tx.select({ id: contactGroups.id, kind: contactGroups.kind }).from(contactGroups).where(inArray(contactGroups.id, p.data.groupIds));
      const fixed = valid.filter((v) => v.kind !== 'smart');
      if (fixed.length) await tx.insert(contactGroupMembers).values(fixed.map((v) => ({ tenantId: ctx.tenantId, groupId: v.id, contactId: row!.id })));
    }
    await auditAs(tx, ctx, 'contact.added', 'contact', row!.id, { source: p.data.source, consentConfirmedBy: ctx.via ? 'api_key' : 'user' });
    return { ok: true as const, data: { id: row!.id, phone: phone.e164 } };
  });
}

export interface ContactSummary { id: string; name: string | null; phone: string; tags: string[]; permission: 'agreed' | 'opted_out' | 'no_record'; source: string | null; addedAt: string }
const permission = (c: string): ContactSummary['permission'] => (c === 'allowed' ? 'agreed' : c === 'stopped' ? 'opted_out' : 'no_record');

/** Search by name or phone, optionally one tag or one group. Capped at 50 per call so an agent cannot dump the whole list in one go. */
export async function searchContactsFor(ctx: ActorCtx, o: { q?: string; tag?: string; groupId?: string; limit?: number }): Promise<Result<{ total: number; contacts: ContactSummary[] }>> {
  const limit = Math.min(50, Math.max(1, Math.trunc(o.limit ?? 20)));
  return db(ctx, async (tx) => {
    const parts = [sql`true`];
    if (o.q?.trim()) { const t = `%${o.q.trim().replace(/[%_\\]/g, '\\$&')}%`; parts.push(sql`(c.name ilike ${t} or c.phone_e164 ilike ${t} or c.email ilike ${t})`); }
    if (o.tag) parts.push(sql`${o.tag} = any(c.tags)`);
    if (o.groupId) {
      if (!/^[0-9a-f-]{36}$/i.test(o.groupId)) return fail('That group id is not valid.');
      parts.push(sql`exists (select 1 from contact_group_members m where m.contact_id = c.id and m.group_id = ${o.groupId}::uuid)`);
    }
    const where = sql.join(parts, sql` and `);
    const [t] = (await tx.execute(sql`select count(*)::int n from contacts c where ${where}`)) as unknown as { n: number }[];
    const rows = (await tx.execute(sql`select c.id, c.name, c.phone_e164, c.tags, c.consent_status, c.consent_source, c.created_at from contacts c where ${where} order by c.created_at desc limit ${limit}`)) as unknown as { id: string; name: string | null; phone_e164: string; tags: string[]; consent_status: string; consent_source: string | null; created_at: Date }[];
    return { ok: true as const, data: { total: t!.n, contacts: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone_e164, tags: r.tags, permission: permission(r.consent_status), source: r.consent_source, addedAt: new Date(r.created_at).toISOString() })) } };
  });
}

export interface GroupSummary { id: string; name: string; kind: 'fixed' | 'segment'; people: number }
export async function listGroupsFor(ctx: ActorCtx): Promise<Result<GroupSummary[]>> {
  return db(ctx, async (tx) => {
    const rows = (await tx.execute(sql`select g.id, g.name, g.kind, (select count(*) from contact_group_members m where m.group_id = g.id)::int as people from contact_groups g order by g.name limit 200`)) as unknown as { id: string; name: string; kind: string; people: number }[];
    return { ok: true as const, data: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind === 'smart' ? ('segment' as const) : ('fixed' as const), people: r.people })) };
  });
}

export async function createGroupFor(ctx: ActorCtx, name: string): Promise<Result<{ id: string }>> {
  const n = name.trim();
  if (n.length < 2 || n.length > 80) return fail('Group names need 2 to 80 characters.');
  return db(ctx, async (tx) => {
    const [ex] = await tx.select({ id: contactGroups.id }).from(contactGroups).where(eq(contactGroups.name, n));
    if (ex) return fail('You already have a group with this name.');
    const [row] = await tx.insert(contactGroups).values({ tenantId: ctx.tenantId, name: n, kind: 'static', createdBy: ctx.user.id }).returning({ id: contactGroups.id });
    await auditAs(tx, ctx, 'group.created', 'contact_group', row!.id);
    return { ok: true as const, data: { id: row!.id } };
  });
}

/** Adds existing contacts to a FIXED group. Segments are rule-based, so people cannot be added to them by hand. */
export async function addToGroupFor(ctx: ActorCtx, groupId: string, contactIds: string[]): Promise<Result<{ added: number }>> {
  const ids = z.array(z.string().uuid()).min(1).max(500).safeParse(contactIds);
  if (!ids.success) return fail('Give 1 to 500 contact ids.');
  if (!z.string().uuid().safeParse(groupId).success) return fail('That group id is not valid.');
  return db(ctx, async (tx) => {
    const [g] = await tx.select({ id: contactGroups.id, kind: contactGroups.kind }).from(contactGroups).where(eq(contactGroups.id, groupId));
    if (!g) return fail('That group was not found.');
    if (g.kind === 'smart') return fail('This is a saved segment. Its people come from its rules, so you cannot add people by hand.');
    const mine = await tx.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, ids.data));
    if (!mine.length) return fail('None of those contacts were found.');
    const ins = await tx.insert(contactGroupMembers).values(mine.map((m) => ({ tenantId: ctx.tenantId, groupId: g.id, contactId: m.id }))).onConflictDoNothing().returning({ c: contactGroupMembers.contactId });
    await auditAs(tx, ctx, 'group.members_added', 'contact_group', g.id, { added: ins.length });
    return { ok: true as const, data: { added: ins.length } };
  });
}

export interface TemplateSummary { id: string; name: string; language: string; category: string; body: string; variables: number; needsOfferCode: boolean; needsOfferEnd: boolean }
/** Approved templates only, with what a campaign must supply. */
export async function listApprovedTemplatesFor(ctx: ActorCtx): Promise<Result<TemplateSummary[]>> {
  const { variablesIn } = await import('@lbc/shared');
  return db(ctx, async (tx) => {
    const rows = await tx.select().from(templates).where(eq(templates.status, 'approved'));
    return { ok: true as const, data: rows.map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category, body: t.body, variables: new Set(variablesIn(t.body)).size, needsOfferCode: ((t.buttons ?? []) as { type: string }[]).some((b) => b.type === 'copy_code'), needsOfferEnd: !!(t.offer as { hasExpiration?: boolean } | null)?.hasExpiration })) };
  });
}

export interface CampaignSummary { id: string; name: string; status: string; template: string | null; scheduledAt: string | null; estCostPaise: number; counts: Record<string, number> }
export async function listCampaignsFor(ctx: ActorCtx, limit = 20): Promise<Result<CampaignSummary[]>> {
  return db(ctx, async (tx) => {
    const rows = (await tx.execute(sql`select c.id, c.name, c.status, t.name as template, c.scheduled_at, c.est_cost_paise, c.counts from campaigns c left join templates t on t.id = c.template_id order by c.created_at desc limit ${Math.min(50, Math.max(1, Math.trunc(limit)))}`)) as unknown as { id: string; name: string; status: string; template: string | null; scheduled_at: Date | null; est_cost_paise: number; counts: Record<string, number> }[];
    return { ok: true as const, data: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, template: r.template, scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null, estCostPaise: r.est_cost_paise, counts: r.counts })) };
  });
}

export async function campaignStatusFor(ctx: ActorCtx, id: string): Promise<Result<CampaignSummary>> {
  if (!z.string().uuid().safeParse(id).success) return fail('That campaign id is not valid.');
  return db(ctx, async (tx) => {
    const rows = (await tx.execute(sql`select c.id, c.name, c.status, t.name as template, c.scheduled_at, c.est_cost_paise, c.counts from campaigns c left join templates t on t.id = c.template_id where c.id = ${id}::uuid`)) as unknown as { id: string; name: string; status: string; template: string | null; scheduled_at: Date | null; est_cost_paise: number; counts: Record<string, number> }[];
    const r = rows[0];
    if (!r) return fail('That campaign was not found.');
    return { ok: true as const, data: { id: r.id, name: r.name, status: r.status, template: r.template, scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null, estCostPaise: r.est_cost_paise, counts: r.counts } };
  });
}

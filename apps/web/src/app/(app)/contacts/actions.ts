'use server';

import { revalidatePath } from 'next/cache';
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { CONSENT_SOURCES, normalizePhone, planLimits } from '@lbc/shared';
import { auditLog, contactConsentEvents, contactGroupMembers, contactGroups, contacts } from '@lbc/db';
import { Forbidden, assertRole, db, requireCtx, type Ctx } from '@/lib/session';
import { toCsv, type ParsedRow } from '@/lib/contacts/import';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

async function guard(min: 'agent' | 'admin' = 'admin'): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, min); } catch (e) {
    if (e instanceof Forbidden) return { error: 'Your role cannot do this. Ask the workspace owner.' };
    throw e;
  }
  return { ctx };
}

const consentSource = z.enum(CONSENT_SOURCES);

/* ---------------------------------------------------------------- list */
export interface ListQuery { q?: string; consent?: 'all' | 'allowed' | 'stopped' | 'unknown'; group?: string; tag?: string; page?: number; pageSize?: number }
export interface ContactRow { id: string; name: string | null; phone: string; email: string | null; tags: string[]; consentStatus: string; consentSource: string | null; createdAt: string; groups: string[] }

export async function listContacts(query: ListQuery) {
  const ctx = await requireCtx();
  const page = Math.max(1, query.page ?? 1);
  const size = Math.min(100, Math.max(5, query.pageSize ?? 25));
  return db(ctx, async (tx) => {
    const where: (SQL | undefined)[] = [];
    if (query.q?.trim()) {
      const t = `%${query.q.trim().replace(/[%_\\]/g, '\\$&')}%`;
      where.push(or(ilike(contacts.name, t), ilike(contacts.phoneE164, t), ilike(contacts.email, t)));
    }
    if (query.consent && query.consent !== 'all') where.push(eq(contacts.consentStatus, query.consent));
    if (query.tag) where.push(sql`${query.tag} = any(${contacts.tags})`);
    if (query.group) where.push(sql`exists (select 1 from contact_group_members m where m.contact_id = ${contacts.id} and m.group_id = ${query.group})`);
    const w = where.length ? and(...where) : undefined;

    const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(contacts).where(w);
    const rows = await tx.select().from(contacts).where(w).orderBy(desc(contacts.createdAt)).limit(size).offset((page - 1) * size);
    const ids = rows.map((r) => r.id);
    const memberships = ids.length
      ? await tx.select({ contactId: contactGroupMembers.contactId, name: contactGroups.name }).from(contactGroupMembers).innerJoin(contactGroups, eq(contactGroups.id, contactGroupMembers.groupId)).where(inArray(contactGroupMembers.contactId, ids))
      : [];
    const out: ContactRow[] = rows.map((r) => ({
      id: r.id, name: r.name, phone: r.phoneE164, email: r.email, tags: r.tags, consentStatus: r.consentStatus, consentSource: r.consentSource,
      createdAt: r.createdAt.toISOString(), groups: memberships.filter((m) => m.contactId === r.id).map((m) => m.name),
    }));
    return { rows: out, total, page, pageSize: size };
  });
}

export async function contactSummary() {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const [r] = await tx.select({
      total: count(),
      allowed: sql<number>`count(*) filter (where consent_status = 'allowed')`.mapWith(Number),
      stopped: sql<number>`count(*) filter (where consent_status = 'stopped')`.mapWith(Number),
      unknown: sql<number>`count(*) filter (where consent_status = 'unknown')`.mapWith(Number),
    }).from(contacts);
    const tagRows = await tx.execute(sql`select t as tag, count(*)::int as n from contacts, unnest(tags) t group by t order by n desc limit 30`);
    return { ...r!, limit: planLimits(ctx.workspace.plan).contacts, tags: tagRows as unknown as { tag: string; n: number }[] };
  });
}

/* ---------------------------------------------------------------- add one */
const addSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(1, 'Enter a phone number.'),
  email: z.string().trim().email('That email does not look right.').optional().or(z.literal('')),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  groupIds: z.array(z.string().uuid()).default([]),
  consent: z.boolean(),
  source: consentSource,
});

export async function addContact(input: z.input<typeof addSchema>): Promise<Result<{ id: string }>> {
  const g = await guard('agent'); if ('error' in g) return fail(g.error);
  const p = addSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details and try again.');
  const phone = normalizePhone(p.data.phone);
  if (!phone.ok) return fail(phone.reason);
  if (!p.data.consent) return fail('Please confirm this customer agreed to get WhatsApp messages from you.');

  return db(g.ctx, async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(contacts);
    if (n >= planLimits(g.ctx.workspace.plan).contacts) return fail(`Your plan allows ${planLimits(g.ctx.workspace.plan).contacts.toLocaleString('en-IN')} contacts. Upgrade to add more.`);
    const exists = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone.e164));
    if (exists.length) return fail('This number is already in your contacts.');
    const [row] = await tx.insert(contacts).values({
      tenantId: g.ctx.tenantId, phoneE164: phone.e164, name: p.data.name || null, email: p.data.email || null, tags: [...new Set(p.data.tags)],
      consentStatus: 'allowed', consentSource: p.data.source, consentAt: new Date(),
    }).returning({ id: contacts.id });
    await tx.insert(contactConsentEvents).values({ tenantId: g.ctx.tenantId, contactId: row!.id, action: 'opt_in', source: p.data.source, actorUserId: g.ctx.user.id });
    if (p.data.groupIds.length) {
      const valid = await tx.select({ id: contactGroups.id }).from(contactGroups).where(inArray(contactGroups.id, p.data.groupIds));
      if (valid.length) await tx.insert(contactGroupMembers).values(valid.map((v) => ({ tenantId: g.ctx.tenantId, groupId: v.id, contactId: row!.id })));
    }
    revalidatePath('/contacts');
    return { ok: true as const, data: { id: row!.id } };
  });
}

/* ---------------------------------------------------------------- import */
export interface ImportInput { rows: Pick<ParsedRow, 'line' | 'phone' | 'name' | 'email' | 'tags' | 'error' | 'duplicateOf'>[]; source: string; consent: boolean; groupIds: string[]; newGroup?: string; updateExisting: boolean; fileName?: string }
export interface ImportReport { added: number; updated: number; skippedExisting: number; invalid: number; duplicatesInFile: number; overLimit: number; groupId?: string; errors: { line: number; reason: string }[] }

export async function importContacts(input: ImportInput): Promise<Result<ImportReport>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  if (!input.consent) return fail('Please confirm these customers agreed to get WhatsApp messages from you.');
  const src = consentSource.safeParse(input.source);
  if (!src.success) return fail('Choose where these customers agreed to messages.');
  if (input.rows.length > 20_000) return fail('Please import up to 20,000 rows at a time.');

  const report: ImportReport = { added: 0, updated: 0, skippedExisting: 0, invalid: 0, duplicatesInFile: 0, overLimit: 0, errors: [] };
  const good = input.rows.filter((r) => {
    if (r.error || !r.phone) { report.invalid++; report.errors.push({ line: r.line, reason: r.error ?? 'No phone number.' }); return false; }
    if (r.duplicateOf !== undefined) { report.duplicatesInFile++; report.errors.push({ line: r.line, reason: `Same number as line ${r.duplicateOf}.` }); return false; }
    // Re-validate on the server: never trust the browser's parse.
    const n = normalizePhone(r.phone);
    if (!n.ok) { report.invalid++; report.errors.push({ line: r.line, reason: n.reason }); return false; }
    r.phone = n.e164;
    return true;
  });

  return db(g.ctx, async (tx) => {
    const limit = planLimits(g.ctx.workspace.plan).contacts;
    const [{ n: have } = { n: 0 }] = await tx.select({ n: count() }).from(contacts);
    let room = Math.max(0, limit - have);

    let groupIds = [...input.groupIds];
    if (input.newGroup?.trim()) {
      const name = input.newGroup.trim().slice(0, 80);
      const [ex] = await tx.select({ id: contactGroups.id }).from(contactGroups).where(eq(contactGroups.name, name));
      const id = ex?.id ?? (await tx.insert(contactGroups).values({ tenantId: g.ctx.tenantId, name, kind: 'static', createdBy: g.ctx.user.id }).returning({ id: contactGroups.id }))[0]!.id;
      groupIds.push(id); report.groupId = id;
    }
    if (groupIds.length) groupIds = (await tx.select({ id: contactGroups.id }).from(contactGroups).where(inArray(contactGroups.id, groupIds))).map((x) => x.id);

    const CH = 500;
    for (let i = 0; i < good.length; i += CH) {
      const chunk = good.slice(i, i + CH);
      const existing = await tx.select().from(contacts).where(inArray(contacts.phoneE164, chunk.map((c) => c.phone!)));
      const byPhone = new Map(existing.map((e) => [e.phoneE164, e]));
      const toInsert: (typeof contacts.$inferInsert)[] = [];
      const memberIds: string[] = [];

      for (const r of chunk) {
        const ex = byPhone.get(r.phone!);
        if (ex) {
          memberIds.push(ex.id);
          if (input.updateExisting && ex.consentStatus !== 'stopped') {
            await tx.update(contacts).set({
              name: r.name ?? ex.name, email: r.email ?? ex.email, tags: [...new Set([...ex.tags, ...r.tags])], updatedAt: new Date(),
              ...(ex.consentStatus === 'unknown' ? { consentStatus: 'allowed', consentSource: src.data, consentAt: new Date() } : {}),
            }).where(eq(contacts.id, ex.id));
            report.updated++;
          } else report.skippedExisting++;
        } else if (room > 0) {
          room--;
          toInsert.push({ tenantId: g.ctx.tenantId, phoneE164: r.phone!, name: r.name ?? null, email: r.email ?? null, tags: [...new Set(r.tags)], consentStatus: 'allowed', consentSource: src.data, consentAt: new Date() });
        } else { report.overLimit++; report.errors.push({ line: r.line, reason: `Your plan limit of ${limit.toLocaleString('en-IN')} contacts was reached.` }); }
      }
      if (toInsert.length) {
        const ins = await tx.insert(contacts).values(toInsert).onConflictDoNothing().returning({ id: contacts.id });
        report.added += ins.length;
        memberIds.push(...ins.map((x) => x.id));
        await tx.insert(contactConsentEvents).values(ins.map((x) => ({ tenantId: g.ctx.tenantId, contactId: x.id, action: 'opt_in' as const, source: src.data, actorUserId: g.ctx.user.id, note: input.fileName ? `Imported from ${input.fileName.slice(0, 80)}` : 'Imported' })));
      }
      if (groupIds.length && memberIds.length) {
        await tx.insert(contactGroupMembers).values(groupIds.flatMap((gid) => memberIds.map((cid) => ({ tenantId: g.ctx.tenantId, groupId: gid, contactId: cid })))).onConflictDoNothing();
      }
    }
    await tx.execute(sql`select 1`); // keep the transaction open until all chunks are done
    revalidatePath('/contacts');
    return { ok: true as const, data: report };
  });
}

/* ---------------------------------------------------------------- groups */
export interface GroupRow { id: string; name: string; kind: string; count: number }
export async function listGroups(): Promise<GroupRow[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const rows = await tx.execute(sql`select g.id, g.name, g.kind, (select count(*) from contact_group_members m where m.group_id = g.id)::int as count from contact_groups g order by g.name`);
    return rows as unknown as GroupRow[];
  });
}

export async function createGroup(name: string): Promise<Result<{ id: string }>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  const n = name.trim();
  if (n.length < 2 || n.length > 80) return fail('Group names need 2 to 80 characters.');
  return db(g.ctx, async (tx) => {
    const [ex] = await tx.select({ id: contactGroups.id }).from(contactGroups).where(eq(contactGroups.name, n));
    if (ex) return fail('You already have a group with this name.');
    const [row] = await tx.insert(contactGroups).values({ tenantId: g.ctx.tenantId, name: n, kind: 'static', createdBy: g.ctx.user.id }).returning({ id: contactGroups.id });
    revalidatePath('/contacts');
    return { ok: true as const, data: { id: row!.id } };
  });
}

export async function renameGroup(id: string, name: string): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  const n = name.trim();
  if (n.length < 2 || n.length > 80) return fail('Group names need 2 to 80 characters.');
  return db(g.ctx, async (tx) => {
    const dup = await tx.select({ id: contactGroups.id }).from(contactGroups).where(and(eq(contactGroups.name, n), sql`${contactGroups.id} <> ${id}`));
    if (dup.length) return fail('You already have a group with this name.');
    await tx.update(contactGroups).set({ name: n, updatedAt: new Date() }).where(eq(contactGroups.id, id));
    revalidatePath('/contacts');
    return { ok: true as const, data: null };
  });
}

export async function deleteGroup(id: string): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    await tx.delete(contactGroups).where(eq(contactGroups.id, id)); // members cascade; contacts are kept
    await tx.insert(auditLog).values({ tenantId: g.ctx.tenantId, actorUserId: g.ctx.user.id, actorType: 'user', action: 'group.deleted', entity: 'contact_group', entityId: id });
    revalidatePath('/contacts');
    return { ok: true as const, data: null };
  });
}

/* ---------------------------------------------------------------- bulk */
const idsSchema = z.array(z.string().uuid()).min(1, 'Select at least one contact.').max(5000);

export type BulkAction =
  | { type: 'addToGroup'; groupId: string }
  | { type: 'removeFromGroup'; groupId: string }
  | { type: 'addTag'; tag: string }
  | { type: 'removeTag'; tag: string }
  | { type: 'delete' };

export async function bulkAction(ids: string[], action: BulkAction): Promise<Result<{ affected: number }>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  const p = idsSchema.safeParse(ids);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Select at least one contact.');
  return db(g.ctx, async (tx) => {
    let affected = 0;
    if (action.type === 'addToGroup') {
      const [grp] = await tx.select({ id: contactGroups.id }).from(contactGroups).where(eq(contactGroups.id, action.groupId));
      if (!grp) return fail('That group was not found.');
      const mine = await tx.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, p.data));
      const ins = await tx.insert(contactGroupMembers).values(mine.map((m) => ({ tenantId: g.ctx.tenantId, groupId: grp.id, contactId: m.id }))).onConflictDoNothing().returning({ c: contactGroupMembers.contactId });
      affected = ins.length;
    } else if (action.type === 'removeFromGroup') {
      const del = await tx.delete(contactGroupMembers).where(and(eq(contactGroupMembers.groupId, action.groupId), inArray(contactGroupMembers.contactId, p.data))).returning({ c: contactGroupMembers.contactId });
      affected = del.length;
    } else if (action.type === 'addTag' || action.type === 'removeTag') {
      const tag = action.tag.trim().slice(0, 40);
      if (!tag) return fail('Enter a tag.');
      const res = await tx.update(contacts).set({
        tags: action.type === 'addTag' ? sql`(select array(select distinct unnest(${contacts.tags} || array[${tag}]::text[])))` : sql`array_remove(${contacts.tags}, ${tag})`,
        updatedAt: new Date(),
      }).where(inArray(contacts.id, p.data)).returning({ id: contacts.id });
      affected = res.length;
    } else if (action.type === 'delete') {
      if (g.ctx.role === 'admin' || g.ctx.role === 'owner') {
        const del = await tx.delete(contacts).where(inArray(contacts.id, p.data)).returning({ id: contacts.id });
        affected = del.length;
        await tx.insert(auditLog).values({ tenantId: g.ctx.tenantId, actorUserId: g.ctx.user.id, actorType: 'user', action: 'contacts.deleted', entity: 'contact', after: { count: affected } });
      }
    }
    revalidatePath('/contacts');
    return { ok: true as const, data: { affected } };
  });
}

/* ---------------------------------------------------------------- opt-out / resume */
export async function setConsent(id: string, status: 'stopped' | 'allowed', source: string): Promise<Result> {
  const g = await guard('agent'); if ('error' in g) return fail(g.error);
  const src = consentSource.safeParse(source);
  return db(g.ctx, async (tx) => {
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, id));
    if (!c) return fail('Contact not found.');
    if (status === 'allowed' && c.consentStatus === 'stopped') return fail('This customer asked to stop. They can only restart by sending START to your WhatsApp number.');
    if (status === 'allowed' && !src.success) return fail('Choose where this customer agreed to messages.');
    await tx.update(contacts).set(status === 'stopped'
      ? { consentStatus: 'stopped', optOutAt: new Date(), optOutSource: 'agent', updatedAt: new Date() }
      : { consentStatus: 'allowed', consentSource: src.success ? src.data : null, consentAt: new Date(), updatedAt: new Date() }).where(eq(contacts.id, id));
    await tx.insert(contactConsentEvents).values({ tenantId: g.ctx.tenantId, contactId: id, action: status === 'stopped' ? 'opt_out' : 'opt_in', source: status === 'stopped' ? 'agent' : source, actorUserId: g.ctx.user.id });
    revalidatePath('/contacts');
    return { ok: true as const, data: null };
  });
}

/* ---------------------------------------------------------------- export */
export async function exportContacts(opts: { ids?: string[]; group?: string }): Promise<Result<{ csv: string; count: number }>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const conds: SQL[] = [];
    if (opts.ids?.length) conds.push(inArray(contacts.id, opts.ids.slice(0, 20000)));
    if (opts.group) conds.push(sql`exists (select 1 from contact_group_members m where m.contact_id = ${contacts.id} and m.group_id = ${opts.group})`);
    const rows = await tx.select().from(contacts).where(conds.length ? and(...conds) : undefined).orderBy(desc(contacts.createdAt)).limit(50000);
    await tx.insert(auditLog).values({ tenantId: g.ctx.tenantId, actorUserId: g.ctx.user.id, actorType: 'user', action: 'contacts.exported', entity: 'contact', after: { count: rows.length } });
    const csv = toCsv([['Name', 'Phone', 'Email', 'Tags', 'Permission', 'Source', 'Added'], ...rows.map((r) => [r.name, r.phoneE164, r.email, r.tags.join('; '), r.consentStatus === 'allowed' ? 'Opted in' : r.consentStatus === 'stopped' ? 'Opted out' : 'Not recorded', r.consentSource, r.createdAt.toISOString().slice(0, 10)])]);
    return { ok: true as const, data: { csv, count: rows.length } };
  });
}

'use server';

import { revalidatePath } from 'next/cache';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { lintTemplate, type Category } from '@lbc/shared';
import { templates } from '@lbc/db';
import type { Tx } from '@lbc/db';
import { Forbidden, assertRole, db, requireCtx, type Ctx, audit } from '@/lib/session';

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

export interface TemplateRow {
  id: string; name: string; language: string; category: Category; status: string; headerText: string | null; headerMedia: 'image' | 'video' | 'document' | null; assetId: string | null; assetName: string | null; body: string; footer: string | null;
  buttons: { type: 'quick_reply' | 'url' | 'phone' | 'copy_code'; text: string; value?: string }[]; samples: string[]; quality: string; rejectionReason: string | null; updatedAt: string; submitError: string | null; live: boolean;
}

export async function listTemplates(): Promise<TemplateRow[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const live = await isLive(tx);
    const rows = (await tx.select().from(templates).orderBy(desc(templates.updatedAt))).filter((r) => r.status !== 'deleting');
    const assets = (await tx.execute(sql`select id, template_id, file_name from template_assets where template_id is not null`)) as unknown as { id: string; template_id: string; file_name: string }[];
    const byTpl = new Map(assets.map((a) => [a.template_id, a]));
    return rows.map((r) => ({
      headerMedia: (['image', 'video', 'document'].includes(r.headerType) ? r.headerType : null) as TemplateRow['headerMedia'], assetId: byTpl.get(r.id)?.id ?? null, assetName: byTpl.get(r.id)?.file_name ?? null,
      id: r.id, name: r.name, language: r.language, category: r.category as Category, status: r.status, headerText: r.headerText, body: r.body, footer: r.footer,
      buttons: r.buttons as TemplateRow['buttons'], samples: r.samples as string[], quality: r.quality, rejectionReason: r.rejectionReason, updatedAt: r.updatedAt.toISOString(), submitError: r.submitError, live,
    }));
  });
}

const draft = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(512),
  language: z.enum(['en', 'hi', 'en_US', 'hi_IN']).default('en'),
  category: z.enum(['marketing', 'utility', 'authentication']),
  headerText: z.string().max(200).optional(),
  /** A picture, video or PDF header. The file itself is uploaded first (/api/template-assets) and referenced by `assetId`. */
  headerMedia: z.enum(['image', 'video', 'document']).nullable().optional(),
  assetId: z.string().uuid().nullable().optional(),
  body: z.string().max(5000),
  footer: z.string().max(200).optional(),
  buttons: z.array(z.object({ type: z.enum(['quick_reply', 'url', 'phone', 'copy_code']), text: z.string().max(60), value: z.string().max(2100).optional() })).max(12),
  samples: z.array(z.string().max(200)).max(20),
});
export type DraftInput = z.input<typeof draft>;

/** Makes `assetId` the template's one header file and removes any earlier one (a changed file is a fresh upload to Meta). Null removes the header file. */
async function attachAsset(tx: Tx, templateId: string, assetId: string | null) {
  await tx.execute(sql`delete from template_assets where template_id = ${templateId} and (${assetId}::uuid is null or id <> ${assetId}::uuid)`);
  if (assetId) await tx.execute(sql`update template_assets set template_id = ${templateId} where id = ${assetId} and (template_id is null or template_id = ${templateId})`);
}

/** Saves a draft. Drafts need no checks, so people can save half-finished work. Submitting runs the full checker. */
export async function saveTemplate(input: DraftInput): Promise<Result<{ id: string }>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  const p = draft.safeParse(input);
  if (!p.success) return fail('Check the fields. Some values are too long.');
  const d = p.data;
  return db(g.ctx, async (tx) => {
    const clash = await tx.select({ id: templates.id }).from(templates).where(sql`${templates.name} = ${d.name} and ${templates.language} = ${d.language} and ${templates.id} <> ${d.id ?? '00000000-0000-0000-0000-000000000000'}`);
    if (clash.length) return fail('You already have a format with this name and language.');
    const media = d.headerMedia ?? null;
    if (media && d.headerText) return fail('Use either a text header or a picture, video or PDF, not both.');
    if (media && d.category === 'authentication') return fail('One-time-code formats cannot have a header.');
    if (media) {
      if (!d.assetId) return fail('Choose the header file first.');
      const a = ((await tx.execute(sql`select kind, template_id from template_assets where id = ${d.assetId}`)) as unknown as { kind: string; template_id: string | null }[])[0];
      if (!a) return fail('That header file was not found. Choose it again.');
      if (a.kind !== media) return fail('The file does not match the header type you picked.');
      if (a.template_id && a.template_id !== (d.id ?? null)) return fail('That file is already used by another format.');
    }
    const values = { headerType: media ?? (d.headerText ? 'text' : 'none'), name: d.name, language: d.language, category: d.category, headerText: d.headerText || null, body: d.body, footer: d.footer || null, buttons: d.buttons, samples: d.samples, updatedAt: new Date() };
    if (d.id) {
      const [cur] = await tx.select().from(templates).where(eq(templates.id, d.id));
      if (!cur) return fail('Format not found.');
      if (cur.status === 'pending') return fail('This format is in review. You can edit it after the result.');
      if (cur.status === 'approved' && cur.category !== d.category) return fail('The type of an approved format cannot change. Create a new format instead.');
      await tx.update(templates).set({ ...values, status: cur.status === 'approved' ? 'draft' : cur.status === 'rejected' ? 'draft' : cur.status }).where(eq(templates.id, d.id));
      await attachAsset(tx, d.id, media ? d.assetId! : null);
      revalidatePath('/templates');
      return { ok: true as const, data: { id: d.id } };
    }
    const [row] = await tx.insert(templates).values({ tenantId: g.ctx.tenantId, ...values, status: 'draft', createdBy: g.ctx.user.id }).returning({ id: templates.id });
    await attachAsset(tx, row!.id, media ? d.assetId! : null);
    revalidatePath('/templates');
    return { ok: true as const, data: { id: row!.id } };
  });
}

/** True when a valid WhatsApp connection exists, so submissions go to Meta through the worker. */
async function isLive(tx: Tx): Promise<boolean> {
  const r = await tx.execute(sql`select exists(select 1 from meta_accounts where token_status = 'valid' and health_state = 'ok') as live`);
  return (r as unknown as { live: boolean }[])[0]?.live === true;
}

/** Runs the pre-submit checker on the server (never trust the browser) and sends the format for review. */
export async function submitTemplate(id: string): Promise<Result<{ testMode: boolean }>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const [t] = await tx.select().from(templates).where(eq(templates.id, id));
    if (!t) return fail('Format not found.');
    if (t.status === 'pending' || t.status === 'approved') return fail('This format was already submitted.');
    const others = await tx.select({ name: templates.name, body: templates.body }).from(templates).where(sql`${templates.id} <> ${id}`);
    const r = lintTemplate({ name: t.name, category: t.category as Category, headerText: t.headerText ?? undefined, headerMedia: (['image', 'video', 'document'].includes(t.headerType) ? t.headerType : undefined) as 'image' | undefined, hasHeaderFile: ['image', 'video', 'document'].includes(t.headerType) ? ((await tx.execute(sql`select 1 from template_assets where template_id = ${id}`)) as unknown as unknown[]).length > 0 : undefined, body: t.body, footer: t.footer ?? undefined, buttons: t.buttons as TemplateRow['buttons'], samples: t.samples as string[] }, others.map((o) => o.name), others.map((o) => o.body));
    if (r.blocked) return fail(r.issues.find((i) => i.level === 'block')!.message);
    const live = await isLive(tx);
    await tx.update(templates).set({ status: 'pending', rejectionReason: null, updatedAt: new Date(), submitError: null, submitAttempts: 0, submitRequestedAt: live ? new Date() : null }).where(eq(templates.id, id));
    await audit(tx, 'template.submitted', 'template', id, { live });
    revalidatePath('/templates');
    // Connected: the worker sends it to Meta within seconds and Meta's answer arrives by webhook or the next sync.
    // Not connected: nothing leaves this server and the review is simulated in test mode.
    return { ok: true as const, data: { testMode: !live } };
  });
}

/** TEST MODE ONLY: stands in for Meta's review result until a real number is connected. */
export async function simulateReview(id: string, outcome: 'approved' | 'rejected'): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const [t] = await tx.select().from(templates).where(eq(templates.id, id));
    if (!t || t.status !== 'pending') return fail('Only formats in review can be decided.');
    if (await isLive(tx)) return fail('Your number is connected, so Meta decides. Wait for its answer.');
    await tx.update(templates).set(outcome === 'approved'
      ? { status: 'approved', quality: 'green', rejectionReason: null, updatedAt: new Date() }
      : { status: 'rejected', rejectionReason: 'INVALID_FORMAT', updatedAt: new Date() }).where(eq(templates.id, id));
    revalidatePath('/templates');
    return { ok: true as const, data: null };
  });
}

export async function deleteTemplate(id: string): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const used = await tx.execute(sql`select 1 from campaigns where template_id = ${id} and status in ('scheduled','running') limit 1`);
    if ((used as unknown as unknown[]).length) return fail('A scheduled or running bulk send uses this message format.');
    const [cur] = await tx.select({ meta: templates.metaTemplateId }).from(templates).where(eq(templates.id, id));
    if (cur?.meta) await tx.update(templates).set({ status: 'deleting', updatedAt: new Date() }).where(eq(templates.id, id)); // the worker removes it at Meta, then here
    else await tx.delete(templates).where(eq(templates.id, id));
    await audit(tx, 'template.deleted', 'template', id);
    revalidatePath('/templates');
    return { ok: true as const, data: null };
  });
}

export async function duplicateTemplate(id: string): Promise<Result<{ id: string }>> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const [t] = await tx.select().from(templates).where(eq(templates.id, id));
    if (!t) return fail('Format not found.');
    let n = 2, name = `${t.name}_copy`;
    for (;;) {
      const ex = await tx.select({ id: templates.id }).from(templates).where(sql`${templates.name} = ${name} and ${templates.language} = ${t.language}`);
      if (!ex.length) break;
      name = `${t.name}_copy${n++}`;
    }
    const [row] = await tx.insert(templates).values({ tenantId: g.ctx.tenantId, name, language: t.language, category: t.category, status: 'draft', headerType: t.headerType, headerText: t.headerText, body: t.body, footer: t.footer, buttons: t.buttons, samples: t.samples, createdBy: g.ctx.user.id }).returning({ id: templates.id });
    if (['image', 'video', 'document'].includes(t.headerType)) {
      await tx.execute(sql`insert into template_assets (tenant_id, template_id, kind, mime, file_name, size_bytes, sha256, data, created_by)
        select tenant_id, ${row!.id}, kind, mime, file_name, size_bytes, sha256, data, ${g.ctx.user.id} from template_assets where template_id = ${id}`);
    }
    revalidatePath('/templates');
    return { ok: true as const, data: { id: row!.id } };
  });
}

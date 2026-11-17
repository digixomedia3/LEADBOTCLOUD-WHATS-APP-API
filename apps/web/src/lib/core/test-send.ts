/**
 * Test send: try a template on your own phone before sending it to customers.
 * Rules, all decided here so the panel and the API for AI agents cannot differ:
 *  - A test goes only to numbers the workspace saved as its own test numbers (at most 5). It can never reach a stranger.
 *  - It is a real WhatsApp message through the normal queue, so Meta's rules and your charges apply exactly as for any message. Nothing is simulated.
 *  - At most 20 test messages an hour per workspace, so a loop or a mistake cannot become a flood.
 *  - Only approved templates. Templates with a tracked website button cannot be tested here (that link needs a campaign to belong to).
 */
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { normalizePhone, variablesIn, resolveVar } from '@lbc/shared';
import { isTrackedButtonValue } from '@lbc/shared/tracked-links';
import { auditAs, db, type ActorCtx } from '@/lib/tenant-db';
import { fail, type Result } from '@/lib/core/campaigns';

export const MAX_TEST_NUMBERS = 5;
export const MAX_TESTS_PER_HOUR = 20;

export interface TestNumber { id: string; phone: string; label: string }
type Rows<T> = T[];
const rows = <T,>(r: unknown) => r as Rows<T>;

export async function listTestNumbers(ctx: ActorCtx): Promise<TestNumber[]> {
  return db(ctx, async (tx) => rows<{ id: string; phone_e164: string; label: string }>(await tx.execute(sql`select id, phone_e164, label from test_numbers order by created_at`)).map((r) => ({ id: r.id, phone: r.phone_e164, label: r.label })));
}

const labelSchema = z.string().trim().min(1, 'Give this number a name, like “My phone”.').max(40, 'The name can be 40 characters at most.');

export async function addTestNumber(ctx: ActorCtx, rawPhone: string, rawLabel: string): Promise<Result<TestNumber>> {
  const label = labelSchema.safeParse(rawLabel); if (!label.success) return fail(label.error.issues[0]!.message);
  const p = normalizePhone(rawPhone); if (!p.ok) return fail(p.reason);
  return db(ctx, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'test_numbers:' + ctx.tenantId}))`);
    const have = rows<{ n: number }>(await tx.execute(sql`select count(*)::int as n from test_numbers`))[0]!.n;
    if (have >= MAX_TEST_NUMBERS) return fail(`You can keep ${MAX_TEST_NUMBERS} test numbers. Remove one first.`);
    if (rows(await tx.execute(sql`select 1 from test_numbers where phone_e164 = ${p.e164}`)).length) return fail('That number is already a test number.');
    // The number is also a normal contact, so STOP, delivery and the chat behave exactly as for customers. We never change someone else's permission or undo an opt-out.
    let c = rows<{ id: string; consent_status: string }>(await tx.execute(sql`select id, consent_status from contacts where tenant_id = ${ctx.tenantId}::uuid and phone_e164 = ${p.e164}`))[0];
    if (c) {
      if (c.consent_status === 'stopped') return fail('This person has opted out of messages, so it cannot be used as a test number.');
      if (c.consent_status !== 'allowed') return fail('This number is already one of your contacts, with no permission recorded. Mark them as having agreed to messages first, or use a different number.');
    } else {
      c = rows<{ id: string; consent_status: string }>(await tx.execute(sql`
        insert into contacts (tenant_id, phone_e164, name, tags, consent_status, consent_source, consent_at)
        values (${ctx.tenantId}::uuid, ${p.e164}, ${label.data}, array['test-number'], 'allowed', 'test_number', now()) returning id, consent_status`))[0]!;
    }
    const r = rows<{ id: string }>(await tx.execute(sql`insert into test_numbers (tenant_id, contact_id, phone_e164, label, created_by) values (${ctx.tenantId}::uuid, ${c.id}::uuid, ${p.e164}, ${label.data}, ${ctx.user.id}) returning id`))[0]!;
    await auditAs(tx, ctx, 'test_number.added', 'test_number', r.id, { phone: p.e164 });
    return { ok: true as const, data: { id: r.id, phone: p.e164, label: label.data } };
  });
}

export async function removeTestNumber(ctx: ActorCtx, id: string): Promise<Result> {
  if (!z.string().uuid().safeParse(id).success) return fail('That test number was not found.');
  return db(ctx, async (tx) => {
    const r = rows<{ id: string; phone_e164: string }>(await tx.execute(sql`delete from test_numbers where id = ${id}::uuid returning id, phone_e164`))[0];
    if (!r) return fail('That test number was not found.');
    await auditAs(tx, ctx, 'test_number.removed', 'test_number', r.id, { phone: r.phone_e164 });
    return { ok: true as const, data: null };
  });
}

export const testSendInput = z.object({
  templateId: z.string().uuid('Choose a template.'),
  numberIds: z.array(z.string().uuid()).min(1, 'Choose at least one test number.').max(MAX_TEST_NUMBERS),
  varMap: z.array(z.string().trim().min(1, 'Fill in every variable.').max(200)).max(20).default([]),
  offerCode: z.string().trim().regex(/^[A-Za-z0-9_-]{1,15}$/, 'The offer code can be 1 to 15 letters or numbers.').optional(),
  /** For a countdown offer: when it ends (ISO time). */
  offerEndsAt: z.string().optional(),
});
export type TestSendInput = z.input<typeof testSendInput>;

export async function sendTestFor(ctx: ActorCtx, raw: TestSendInput): Promise<Result<{ sent: number; remainingThisHour: number }>> {
  const p = testSendInput.safeParse(raw); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the details.');
  const d = p.data; const ids = [...new Set(d.numberIds)];
  return db(ctx, async (tx) => {
    // One at a time per workspace, so the hourly limit cannot be beaten by two requests at once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'test_send:' + ctx.tenantId}))`);
    const ws = rows<{ status: string }>(await tx.execute(sql`select status from tenants where id = ${ctx.tenantId}::uuid`))[0];
    if (ws?.status === 'suspended' || ws?.status === 'offboarded') return fail('Sending is switched off for this workspace. Contact support.');
    const live = rows<{ live: boolean }>(await tx.execute(sql`select exists(select 1 from meta_accounts a join phone_numbers p on p.meta_account_id = a.id where a.token_status = 'valid' and a.health_state = 'ok') as live`))[0]!.live;
    if (!live) return fail('Connect your WhatsApp number first. A test is a real message, so it needs a working connection.');

    const t = rows<{ id: string; name: string; language: string; category: string; status: string; body: string; buttons: { type: string; value?: string }[] | null; offer: { hasExpiration?: boolean } | null }>(
      await tx.execute(sql`select id, name, language, category, status, body, buttons, offer from templates where id = ${d.templateId}::uuid`))[0];
    if (!t) return fail('That template was not found.');
    if (t.status !== 'approved') return fail('Only approved templates can be tested.');
    const buttons = t.buttons ?? [];
    const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '');
    if (buttons.some((b) => b.type === 'url' && !!appUrl && isTrackedButtonValue(b.value, appUrl))) return fail('This template has a tracked website button, which needs a campaign to count clicks. Test it by sending a small campaign to a group that holds only your own numbers.');
    const needed = new Set(variablesIn(t.body)).size;
    if (d.varMap.length !== needed) return fail(needed ? `This template has ${needed} variable${needed > 1 ? 's' : ''}. Fill in each one.` : 'This template has no variables.');
    const hasCopy = buttons.some((b) => b.type === 'copy_code');
    if (hasCopy && !d.offerCode) return fail('This template has a Copy code button. Enter the offer code.');
    let offerEnds: number | null = null;
    if (t.offer?.hasExpiration) {
      const e = d.offerEndsAt ? new Date(d.offerEndsAt).getTime() : NaN;
      if (!Number.isFinite(e)) return fail('This offer has a countdown. Choose when the offer ends.');
      if (e < Date.now() + 30 * 60_000) return fail('The offer must end at least 30 minutes from now, so you can see the countdown.');
      if (e > Date.now() + 60 * 86_400_000) return fail('The offer can end at most 60 days from now.');
      offerEnds = e;
    }

    const targets = rows<{ id: string; contact_id: string; phone_e164: string }>(await tx.execute(sql`select id, contact_id, phone_e164 from test_numbers where id = any(${'{' + ids.join(',') + '}'}::uuid[])`));
    if (targets.length !== ids.length) return fail('One of those test numbers was removed. Pick again.');
    const used = rows<{ n: number }>(await tx.execute(sql`select count(*)::int as n from messages where is_test and created_at > now() - interval '1 hour'`))[0]!.n;
    if (used + targets.length > MAX_TESTS_PER_HOUR) return fail(`You can send ${MAX_TESTS_PER_HOUR} test messages an hour, and ${used} have gone out in the last hour. Try again later.`);
    const ph = rows<{ phone_number_id: string }>(await tx.execute(sql`select phone_number_id from phone_numbers order by created_at limit 1`))[0];
    if (!ph) return fail('Connect your WhatsApp number first.');

    let sent = 0;
    for (const n of targets) {
      const c = rows<{ id: string; name: string | null; consent_status: string; reachability: string }>(await tx.execute(sql`select id, name, consent_status, reachability from contacts where id = ${n.contact_id}::uuid`))[0];
      if (!c || c.consent_status === 'stopped') continue;            // they wrote STOP since: respected, exactly like any customer
      const params = d.varMap.map((v) => resolveVar(v, { name: c.name, phone: n.phone_e164 }));
      const conv = rows<{ id: string }>(await tx.execute(sql`
        insert into conversations (tenant_id, contact_id, phone_number_id, status, unread) values (${ctx.tenantId}::uuid, ${c.id}::uuid, ${ph.phone_number_id}, 'open', 0)
        on conflict (tenant_id, contact_id) do update set phone_number_id = excluded.phone_number_id returning id`))[0]!;
      await tx.execute(sql`
        insert into messages (tenant_id, conversation_id, direction, kind, body, status, template_name, template_language, template_category, payload, phone_number_id, is_test)
        values (${ctx.tenantId}::uuid, ${conv.id}::uuid, 'out', 'template', ${t.name}, 'queued', ${t.name}, ${t.language}, ${String(t.category)}, ${JSON.stringify({ params, ...(hasCopy ? { code: d.offerCode } : {}), ...(offerEnds ? { offerExpiresMs: offerEnds } : {}) })}::jsonb, ${ph.phone_number_id}, true)`);
      sent++;
    }
    if (sent === 0) return fail('None of those numbers can receive a test right now (they may have opted out).');
    await auditAs(tx, ctx, 'template.test_sent', 'template', t.id, { numbers: sent });
    return { ok: true as const, data: { sent, remainingThisHour: MAX_TESTS_PER_HOUR - used - sent } };
  });
}

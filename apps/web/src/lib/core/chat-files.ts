/**
 * Sends a file (picture, video or PDF) from the chat. Same rules as a text reply: the 24-hour window must be open and the customer must not
 * have opted out. The file is checked from its own bytes before anything is stored; the message and the file are saved together or not at all.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { attachmentPreview, checkChatAttachment } from '@lbc/shared/chat-attachments';
import { db, type ActorCtx } from '@/lib/tenant-db';

export type FileResult = { ok: true; data: { id: string } } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
/** Each person may send this many files an hour. Stops a stuck loop or a script from filling the database. */
export const FILES_PER_HOUR = 60;

export async function sendChatFile(ctx: ActorCtx, conversationId: string, bytes: Uint8Array, originalName: string, caption: unknown): Promise<FileResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) return fail('Conversation not found.');
  const chk = checkChatAttachment(bytes, originalName, caption);
  if (!chk.ok) return fail(chk.error);
  const sha = createHash('sha256').update(bytes).digest('hex');
  return db(ctx, async (tx) => {
    const c = ((await tx.execute(sql`select c.id, c.contact_id, c.phone_number_id, c.window_expires_at, c.assigned_to, k.consent_status from conversations c join contacts k on k.id = c.contact_id where c.id = ${conversationId}::uuid`)) as unknown as { id: string; contact_id: string; phone_number_id: string | null; window_expires_at: Date | null; assigned_to: string | null; consent_status: string }[])[0];
    if (!c) return fail('Conversation not found.');
    if (!c.window_expires_at || new Date(c.window_expires_at).getTime() < Date.now()) return fail('The 24-hour reply window has closed. Send an approved template to start the conversation again.');
    if (c.consent_status === 'stopped') return fail('This customer opted out. You cannot message them.');
    const recent = Number(((await tx.execute(sql`select count(*)::int as n from message_attachments where created_by = ${ctx.user.id} and created_at > now() - interval '1 hour'`)) as unknown as { n: number }[])[0]!.n);
    if (recent >= FILES_PER_HOUR) return fail(`You have sent ${FILES_PER_HOUR} files in the last hour. Try again a little later.`);
    const live = ((await tx.execute(sql`select exists(select 1 from meta_accounts a join phone_numbers p on p.meta_account_id = a.id where a.token_status = 'valid' and a.health_state = 'ok') as live`)) as unknown as { live: boolean }[])[0]?.live === true;
    const preview = attachmentPreview(chk.kind, chk.caption, chk.fileName);
    const m = ((await tx.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status, sender_user_id, phone_number_id, payload)
      values (${ctx.tenantId}, ${conversationId}::uuid, 'out', ${chk.kind}, ${preview}, ${live ? 'queued' : 'sent'}, ${ctx.user.id}, ${c.phone_number_id}, ${JSON.stringify(chk.caption ? { caption: chk.caption } : {})}::jsonb) returning id`)) as unknown as { id: string }[])[0]!;
    await tx.execute(sql`insert into message_attachments (tenant_id, message_id, kind, mime, file_name, size_bytes, sha256, data, created_by)
      values (${ctx.tenantId}, ${m.id}::uuid, ${chk.kind}, ${chk.mime}, ${chk.fileName}, ${chk.size}, ${sha}, ${Buffer.from(bytes)}, ${ctx.user.id})`);
    await tx.execute(sql`update conversations set last_preview = ${preview.slice(0, 120)}, last_message_at = now(), assigned_to = coalesce(assigned_to, ${ctx.user.id}) where id = ${conversationId}::uuid`);
    return { ok: true as const, data: { id: m.id } };
  });
}

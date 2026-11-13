import { sql } from 'drizzle-orm';
import { backoffMs, errorPolicy, type ErrorPolicy } from '@lbc/shared';
import { GraphClient, MetaError, MetaUnknownOutcome, bodyParams, chooseEndpoint, decryptSecret, rerouteFor, templateMessage, textMessage, withProductPolicy, type SendResponse, type TemplateCategory } from '@lbc/meta';
import type { Db } from '@lbc/db';

type Row = Record<string, unknown>;
const rows = (r: unknown) => r as Row[];

export interface SendDeps { db: Db; graph: GraphClient; tokenKey: string; now?: () => Date }
/** What the queue should do next with this job. */
export type SendResult =
  | { kind: 'skipped'; reason: string }
  | { kind: 'sent'; wamid: string; path: 'mm_api' | 'cloud_api'; held?: boolean }
  | { kind: 'retry'; delayMs: number; code?: number }
  | { kind: 'unknown_outcome' }
  | { kind: 'failed'; code?: number; message: string; action: ErrorPolicy['action']; known: boolean };

const MARKETING_COOLDOWN_NOTE = 'Skipped before sending';

/** Marks the recipient skipped and records why, so the report can explain it. */
async function skip(db: Db, tenantId: string, messageId: string, recipientId: string | null, reason: string) {
  await db.execute(sql`update messages set status = 'failed', error_detail = ${JSON.stringify({ skipped: reason })}::jsonb, failed_at = now() where id = ${messageId} and tenant_id = ${tenantId} and status in ('queued','retry_wait')`);
  if (recipientId) await db.execute(sql`update campaign_recipients set state = 'skipped', reason = ${reason} where id = ${recipientId} and tenant_id = ${tenantId}`);
  return { kind: 'skipped', reason } as const;
}

/**
 * One send attempt for one queued message (spec 4.5 steps 1 to 6). The caller (BullMQ) uses jobId = message id, so a duplicate
 * job cannot exist; this function is also safe to call twice because step 1 refuses anything that already has a wamid.
 */
export async function sendOne(d: SendDeps, tenantId: string, messageId: string): Promise<SendResult> {
  const { db } = d;
  const now = (d.now ?? (() => new Date()))();

  // 1. Idempotency: load the row; skip unless it is still waiting to be sent.
  const m = rows(await db.execute(sql`select * from messages where id = ${messageId} and tenant_id = ${tenantId} limit 1`))[0];
  if (!m) return { kind: 'skipped', reason: 'message_missing' };
  if (m.wamid || !['queued', 'retry_wait'].includes(String(m.status))) return { kind: 'skipped', reason: 'already_handled' };
  const recipientId = (m.campaign_recipient_id as string | null) ?? null;

  const conv = rows(await db.execute(sql`select c.id, c.window_expires_at, c.contact_id from conversations c where c.id = ${m.conversation_id} and c.tenant_id = ${tenantId}`))[0];
  const contact = rows(await db.execute(sql`select id, phone_e164, name, consent_status, freq_cap_hold_until, reachability from contacts where id = ${conv?.contact_id} and tenant_id = ${tenantId}`))[0];
  if (!contact) return skip(db, tenantId, messageId, recipientId, 'Contact was deleted');

  // 3. Live re-check, cheap and from the database, because things change between queueing and sending.
  const acc = rows(await db.execute(sql`select a.id, a.token_status, a.health_state, a.business_token_enc, a.payment_method_status from meta_accounts a where a.tenant_id = ${tenantId} limit 1`))[0];
  if (!acc) return skip(db, tenantId, messageId, recipientId, 'WhatsApp is not connected');
  if (acc.token_status !== 'valid') return skip(db, tenantId, messageId, recipientId, 'WhatsApp connection expired. Reconnect to continue.');
  if (acc.health_state !== 'ok') return skip(db, tenantId, messageId, recipientId, 'Sending is paused because Meta restricted the account.');
  if (acc.payment_method_status === 'failing') return skip(db, tenantId, messageId, recipientId, 'Meta could not charge your card. Update your payment method in Meta.');
  const tenant = rows(await db.execute(sql`select status from tenants where id = ${tenantId}`))[0];
  if (tenant?.status === 'suspended' || tenant?.status === 'offboarded') return skip(db, tenantId, messageId, recipientId, 'This workspace is not active.');

  const isTemplate = !!m.template_name;
  const category = (m.template_category as string | null)?.toUpperCase() as TemplateCategory | undefined;

  if (contact.consent_status === 'stopped') return skip(db, tenantId, messageId, recipientId, 'Customer opted out');
  if (category === 'MARKETING' && contact.consent_status !== 'allowed') return skip(db, tenantId, messageId, recipientId, 'No permission on record');
  if (contact.reachability === 'unreachable') return skip(db, tenantId, messageId, recipientId, 'Customer cannot receive WhatsApp messages');
  if (contact.freq_cap_hold_until && new Date(String(contact.freq_cap_hold_until)) > now) return skip(db, tenantId, messageId, recipientId, 'Meta limited promotional messages to this customer today. Try after 24 hours.');
  if (!isTemplate) {
    const open = conv?.window_expires_at && new Date(String(conv.window_expires_at)) > now;
    if (!open) return skip(db, tenantId, messageId, recipientId, 'The 24-hour reply window is closed. Send an approved message format.');
  }
  if (isTemplate) {
    const t = rows(await db.execute(sql`select status from templates where tenant_id = ${tenantId} and name = ${m.template_name} and language = ${m.template_language} limit 1`))[0];
    if (!t || t.status !== 'approved') return skip(db, tenantId, messageId, recipientId, 'The message format is not approved right now.');
  }

  const ph = rows(await db.execute(sql`select phone_number_id, status from phone_numbers where tenant_id = ${tenantId} and (phone_number_id = ${m.phone_number_id} or ${m.phone_number_id}::text is null) order by created_at limit 1`))[0];
  if (!ph) return skip(db, tenantId, messageId, recipientId, 'No WhatsApp number is connected');
  const phoneNumberId = String(ph.phone_number_id);

  // 4. Claim the row. Only one worker can move queued -> sending; a second attempt updates 0 rows and stops.
  const claimed = rows(await db.execute(sql`update messages set status = 'sending', attempts = attempts + 1, phone_number_id = ${phoneNumberId} where id = ${messageId} and tenant_id = ${tenantId} and status in ('queued','retry_wait') and wamid is null returning id`));
  if (!claimed[0]) return { kind: 'skipped', reason: 'claimed_elsewhere' };

  const token = decryptSecret(String(acc.business_token_enc), d.tokenKey);
  const to = String(contact.phone_e164);
  const payload = (m.payload ?? {}) as { params?: string[]; names?: string[]; text?: string };

  let body: object;
  try {
    body = isTemplate
      ? templateMessage({ to, name: String(m.template_name), language: String(m.template_language ?? 'en'), components: payload.params?.length ? [bodyParams(payload.params, payload.names)] : undefined, messageId })
      : textMessage({ to, body: String(m.body), messageId });
  } catch (e) {
    await db.execute(sql`update messages set status = 'failed', failed_at = now(), error_detail = ${JSON.stringify({ build_error: String((e as Error).message) })}::jsonb where id = ${messageId} and tenant_id = ${tenantId}`);
    return { kind: 'failed', message: 'This message could not be built.', action: 'dlq', known: false };
  }

  let route = chooseEndpoint({ type: isTemplate ? 'template' : 'text', categoryCurrent: category, sendPolicy: undefined, now });
  let res: SendResponse | undefined;
  for (let hop = 0; hop < 2; hop++) {
    try {
      res = route.endpoint === 'marketing_messages'
        ? await d.graph.sendMarketingMessage(phoneNumberId, token, withProductPolicy(body, route.productPolicy ?? 'CLOUD_API_FALLBACK'))
        : await d.graph.sendMessage(phoneNumberId, token, body);
      break;
    } catch (e) {
      if (e instanceof MetaUnknownOutcome) {
        // Spec 4.5 step 6: the message may have been accepted. Never blindly re-send. Wait for a status webhook carrying msg:<id>.
        await db.execute(sql`update messages set status = 'send_unknown' where id = ${messageId} and tenant_id = ${tenantId}`);
        return { kind: 'unknown_outcome' };
      }
      if (e instanceof MetaError) {
        const to2 = hop === 0 ? rerouteFor(e.code) : null;
        if (to2 && to2 !== route.endpoint) { route = { endpoint: to2, productPolicy: to2 === 'marketing_messages' ? 'CLOUD_API_FALLBACK' : undefined }; continue; }
        return handleSendError(d, tenantId, messageId, recipientId, e);
      }
      throw e;
    }
  }
  const sent = res?.messages?.[0];
  if (!sent?.id) {
    await db.execute(sql`update messages set status = 'send_unknown' where id = ${messageId} and tenant_id = ${tenantId}`);
    return { kind: 'unknown_outcome' };
  }
  // A 200 means ACCEPTED only; delivery comes from webhooks.
  const status = sent.message_status === 'held_for_quality_assessment' ? 'held' : sent.message_status === 'paused' ? 'paused' : 'accepted';
  const path = route.endpoint === 'marketing_messages' ? 'mm_api' : 'cloud_api';
  await db.execute(sql`update messages set wamid = ${sent.id}, status = ${status}, status_rank = 0, send_path = ${path}, sent_at = now() where id = ${messageId} and tenant_id = ${tenantId}`);
  if (recipientId) await db.execute(sql`update campaign_recipients set state = 'sent', sent_at = now(), message_id = ${messageId} where id = ${recipientId} and tenant_id = ${tenantId}`);
  if (category === 'MARKETING') await db.execute(sql`update contacts set last_marketing_sent_at = now() where id = ${contact.id} and tenant_id = ${tenantId}`);
  return { kind: 'sent', wamid: sent.id, path, held: status !== 'accepted' };
}

async function handleSendError(d: SendDeps, tenantId: string, messageId: string, recipientId: string | null, e: MetaError): Promise<SendResult> {
  const { db } = d;
  const p = errorPolicy(e.code);
  const attempt = Number(rows(await db.execute(sql`select attempts from messages where id = ${messageId} and tenant_id = ${tenantId}`))[0]?.attempts ?? 1);
  const delay = e.isTransient && p.retry === 'no' ? 5000 : backoffMs(p, attempt - 1);

  // Retry only when the policy says so AND a delay exists. 131049 is retry_delay but handled as a hold, not a retry.
  if (p.retry !== 'no' && p.retry !== 'no_user' && delay !== null && p.action !== 'hold_contact_24h') {
    await db.execute(sql`update messages set status = 'queued', error_code = ${e.code ?? null} where id = ${messageId} and tenant_id = ${tenantId}`);
    if (recipientId) await db.execute(sql`update campaign_recipients set state = 'retry_wait', attempt = attempt + 1, last_error_code = ${e.code ?? null} where id = ${recipientId} and tenant_id = ${tenantId}`);
    return { kind: 'retry', delayMs: delay, code: e.code };
  }

  await db.execute(sql`update messages set status = 'failed', failed_at = now(), error_code = ${e.code ?? null}, error_detail = ${JSON.stringify({ code: e.code, subcode: e.graph.error_subcode, fbtrace_id: e.graph.fbtrace_id, details: e.graph.error_data?.details })}::jsonb where id = ${messageId} and tenant_id = ${tenantId}`);
  if (recipientId) {
    const state = e.code === 131049 ? 'capped' : 'failed';
    await db.execute(sql`update campaign_recipients set state = ${state}, last_error_code = ${e.code ?? null}, reason = ${p.en ?? 'Not delivered'} where id = ${recipientId} and tenant_id = ${tenantId}`);
  }
  // System actions (spec 6)
  if (p.action === 'reconnect') await db.execute(sql`update meta_accounts set token_status = 'invalid', updated_at = now() where tenant_id = ${tenantId}`);
  if (p.action === 'restricted') await db.execute(sql`update meta_accounts set health_state = 'restricted', updated_at = now() where tenant_id = ${tenantId}`);
  if (p.action === 'payment_banner') await db.execute(sql`update meta_accounts set payment_method_status = 'failing', updated_at = now() where tenant_id = ${tenantId}`);
  if (['reconnect', 'restricted', 'payment_banner', 'pause_campaign_24h', 'pause_tenant'].includes(p.action)) {
    await db.execute(sql`update campaigns set status = 'paused', pause_reason = ${p.action} where tenant_id = ${tenantId} and status in ('scheduled','running')`);
  }
  if (p.action === 'hold_contact_24h' || p.action === 'unreachable' || p.action === 'opt_out_contact') {
    const phone = rows(await db.execute(sql`select c.phone_e164 from messages m join conversations v on v.id = m.conversation_id join contacts c on c.id = v.contact_id where m.id = ${messageId} and m.tenant_id = ${tenantId}`))[0]?.phone_e164;
    if (phone) {
      const { applyErrorEffects } = await import('./handlers');
      await applyErrorEffects(db, tenantId, messageId, e.code ?? 0, String(phone));
    }
  }
  return { kind: 'failed', code: e.code, message: p.en ?? 'Not delivered', action: p.action, known: p.known };
}

export const _note = MARKETING_COOLDOWN_NOTE;

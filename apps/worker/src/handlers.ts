import { mediaRefOf, previewFor } from '@lbc/shared/inbound-media';
import { sql } from 'drizzle-orm';
import { errorPolicy, type GraphError } from '@lbc/shared';
import { STATUS_RANK, fromUnixSeconds, isStartText, isStopText, nextStatus, parseCallbackData } from '@lbc/meta';
import { stopRunsFor, type Db } from '@lbc/db';
import { recordAdClick } from './leads';

/**
 * Event handlers (spec 5.4, 5.5). Rules: idempotent (safe to run twice), monotonic (never downgrade a status), tenant-routed by
 * the WABA id (entry.id), and phone_number_id must belong to that tenant or the event is quarantined.
 * The worker role bypasses RLS, so EVERY query here filters by tenant_id explicitly.
 */
type Row = Record<string, unknown>;
export type Outcome = 'ok' | 'orphan_retry' | 'quarantined' | 'ignored' | 'unrouted';
const rows = (r: unknown) => r as Row[];

export async function routeTenant(db: Db, wabaId: string | null, phoneNumberId?: string | null): Promise<{ tenantId: string; phoneRowId: string | null } | 'unknown' | 'mismatch'> {
  if (!wabaId) return 'unknown';
  const a = rows(await db.execute(sql`select tenant_id from meta_accounts where messaging_account_id = ${wabaId} limit 1`))[0];
  if (!a) return 'unknown';
  const tenantId = String(a.tenant_id);
  if (!phoneNumberId) return { tenantId, phoneRowId: null };
  const p = rows(await db.execute(sql`select id from phone_numbers where phone_number_id = ${phoneNumberId} and tenant_id = ${tenantId} limit 1`))[0];
  return p ? { tenantId, phoneRowId: String(p.id) } : 'mismatch';
}

interface StatusPayload { id: string; status: string; timestamp?: string; recipient_id?: string; biz_opaque_callback_data?: string; pricing?: { category?: string; type?: string; pricing_model?: string }; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]; conversation?: unknown }

/** A delivery status for one of our messages. Joins by wamid, falling back to biz_opaque_callback_data (spec 5.4 "status before wamid"). */
export async function handleStatus(db: Db, tenantId: string, s: StatusPayload, attemptNo: number): Promise<Outcome> {
  const when = fromUnixSeconds(s.timestamp) ?? new Date();
  let m = rows(await db.execute(sql`select id, status, wamid, campaign_recipient_id, template_category, pricing_category from messages where tenant_id = ${tenantId} and wamid = ${s.id} limit 1`))[0];
  if (!m) {
    const ref = parseCallbackData(s.biz_opaque_callback_data);
    if (ref) m = rows(await db.execute(sql`select id, status, wamid, campaign_recipient_id, template_category, pricing_category from messages where tenant_id = ${tenantId} and id = ${ref} limit 1`))[0];
  }
  if (!m) return attemptNo >= 5 ? 'ignored' : 'orphan_retry'; // retried by the queue with delay (5 s, 30 s, 2 min), then marked orphaned

  const cur = String(m.status);
  const next = nextStatus(cur, s.status);
  const rank = Math.max(STATUS_RANK[next] ?? -1, 0);
  const err = s.errors?.[0];

  await db.execute(sql`insert into message_status_events (tenant_id, wamid, status, ts, raw) values (${tenantId}, ${s.id}, ${s.status}, ${when.toISOString()}::timestamptz, ${JSON.stringify(s)}::jsonb) on conflict (wamid, status) do nothing`);

  // Pricing is written on the FIRST occurrence only; billable means pricing.type = 'regular' (the old `billable` flag is deprecated).
  const price = s.pricing && !m.pricing_category ? s.pricing : null;

  await db.execute(sql`
    update messages set
      wamid = coalesce(wamid, ${s.id}),
      status = ${next}, status_rank = greatest(status_rank, ${rank}),
      sent_at = case when ${s.status} = 'sent' then coalesce(sent_at, ${when.toISOString()}::timestamptz) else sent_at end,
      delivered_at = case when ${s.status} = 'delivered' then coalesce(delivered_at, ${when.toISOString()}::timestamptz) when ${s.status} = 'read' then coalesce(delivered_at, ${when.toISOString()}::timestamptz) else delivered_at end,
      read_at = case when ${s.status} = 'read' then coalesce(read_at, ${when.toISOString()}::timestamptz) else read_at end,
      failed_at = case when ${s.status} = 'failed' then coalesce(failed_at, ${when.toISOString()}::timestamptz) else failed_at end,
      error_code = case when ${s.status} = 'failed' then ${err?.code ?? null} else error_code end,
      error_detail = case when ${s.status} = 'failed' then ${JSON.stringify(err ?? null)}::jsonb else error_detail end,
      pricing_category = coalesce(pricing_category, ${price?.category ?? null}),
      pricing_type = coalesce(pricing_type, ${price?.type ?? null}),
      billable = coalesce(billable, ${price ? price.type === 'regular' : null}),
      send_path = case when ${price?.category ?? null} = 'marketing_lite' then 'mm_api' when ${price?.category ?? null} = 'marketing' and send_path is distinct from 'mm_api' then coalesce(send_path, 'mm_fallback') else send_path end
    where id = ${m.id} and tenant_id = ${tenantId}`);

  if (m.campaign_recipient_id) {
    const state = s.status === 'failed' ? (err?.code === 131049 ? 'capped' : 'failed') : s.status === 'read' ? 'read' : s.status === 'delivered' ? 'delivered' : s.status === 'sent' ? 'sent' : null;
    if (state) {
      await db.execute(sql`
        update campaign_recipients set state = ${state}, last_error_code = ${err?.code ?? null}, reason = ${state === 'capped' || state === 'failed' ? (errorPolicy(err?.code).en ?? 'Not delivered') : null}
        where id = ${m.campaign_recipient_id} and tenant_id = ${tenantId}
          and (case state when 'queued' then 0 when 'retry_wait' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'replied' then 4 else 5 end)
              <= (case ${state} when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 5 end)`);
    }
  }

  if (s.status === 'failed' && err?.code !== undefined) await applyErrorEffects(db, tenantId, String(m.id), err.code, s.recipient_id);
  return 'ok';
}

/** What a failure code does to the contact (spec 6 "System action"). */
export async function applyErrorEffects(db: Db, tenantId: string, messageId: string, code: number, recipient?: string) {
  const policy = errorPolicy(code);
  const phone = recipient ? (recipient.startsWith('+') ? recipient : `+${recipient}`) : null;
  const contactFilter = sql`tenant_id = ${tenantId} and phone_e164 = ${phone} `;
  if (!phone) return;
  if (policy.action === 'hold_contact_24h') await db.execute(sql`update contacts set freq_cap_hold_until = now() + interval '24 hours', updated_at = now() where ${contactFilter}`);
  else if (policy.action === 'unreachable') await db.execute(sql`update contacts set reachability = 'unreachable', unreachable_since = coalesce(unreachable_since, now()), updated_at = now() where ${contactFilter}`);
  else if (policy.action === 'opt_out_contact') {
    const c = rows(await db.execute(sql`update contacts set consent_status = 'stopped', opt_out_at = coalesce(opt_out_at, now()), opt_out_source = 'user_preferences', updated_at = now() where ${contactFilter} and consent_status <> 'stopped' returning id`))[0];
    if (c) await stopRunsFor(db, tenantId, String(c.id), 'opted_out');
    if (c) await db.execute(sql`insert into contact_consent_events (tenant_id, contact_id, action, source, note) values (${tenantId}, ${c.id}, 'opt_out', 'user_preferences', ${`Meta reported error ${code} on message ${messageId}`})`);
  }
}

interface InboundPayload { [k: string]: unknown; id: string; from?: string; from_user_id?: string; timestamp?: string; type?: string; text?: { body?: string }; button?: { payload?: string; text?: string }; interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } }; context?: { id?: string }; _contacts?: { wa_id?: string; profile?: { name?: string } }[]; referral?: Record<string, unknown> }

/** A message from a customer. Opens the 24-hour window, handles STOP / START, and runs keyword auto-replies. */
export async function handleInbound(db: Db, tenantId: string, phoneNumberId: string | null, m: InboundPayload): Promise<{ outcome: Outcome; autoReply?: string; optedOut?: boolean }> {
  const fromWa = m.from;
  if (!fromWa) return { outcome: 'ignored' }; // BSUID-only senders are not supported yet: log, never guess a phone number
  const phone = `+${fromWa.replace(/\D/g, '')}`;
  const ts = fromUnixSeconds(m.timestamp) ?? new Date();
  const profile = m._contacts?.find((c) => c.wa_id === fromWa)?.profile?.name ?? null;
  const text = m.type === 'text' ? (m.text?.body ?? '') : m.type === 'button' ? (m.button?.payload ?? m.button?.text ?? '') : m.type === 'interactive' ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '') : '';
  const preview = text || previewFor(m as never);
  if (m.type === 'reaction') return { outcome: 'ignored' };   // an emoji on an earlier message is not a new message and must not raise unread

  // contact: match on E.164, create when new (no consent is implied by a customer writing to us)
  let c = rows(await db.execute(sql`select id, consent_status from contacts where tenant_id = ${tenantId} and phone_e164 = ${phone} limit 1`))[0];
  if (!c) c = rows(await db.execute(sql`insert into contacts (tenant_id, phone_e164, name, profile_name, consent_status) values (${tenantId}, ${phone}, ${profile}, ${profile}, 'unknown') on conflict (tenant_id, phone_e164) do update set profile_name = coalesce(excluded.profile_name, contacts.profile_name) returning id, consent_status`))[0]!;
  const contactId = String(c.id);
  await db.execute(sql`update contacts set last_inbound_at = ${ts.toISOString()}::timestamptz, reachability = 'ok', unreachable_since = null, profile_name = coalesce(${profile}, profile_name) where id = ${contactId} and tenant_id = ${tenantId}`);

  // Find or create the conversation WITHOUT touching counters, so a replayed webhook cannot change anything.
  const conv = rows(await db.execute(sql`
    insert into conversations (tenant_id, contact_id, phone_number_id, last_message_at, unread, status)
    values (${tenantId}, ${contactId}, ${phoneNumberId}, ${ts.toISOString()}::timestamptz, 0, 'open')
    on conflict (tenant_id, contact_id) do update set phone_number_id = coalesce(conversations.phone_number_id, excluded.phone_number_id)
    returning id`))[0]!;
  const convId = String(conv.id);

  // Idempotent: the wamid is unique, so a replay inserts nothing and we stop before any counter moves.
  const ins = rows(await db.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status, wamid, phone_number_id, created_at) values (${tenantId}, ${convId}, 'in', ${m.type ?? 'text'}, ${preview}, 'received', ${m.id}, ${phoneNumberId}, ${ts.toISOString()}::timestamptz) on conflict (wamid) where wamid is not null do nothing returning id`));
  if (!ins[0]) return { outcome: 'ok' };
  const ref = mediaRefOf(m as never);
  if (ref) await db.execute(sql`insert into inbound_media (tenant_id, message_id, kind, meta_media_id, mime, file_name, caption) values (${tenantId}, ${ins[0].id}, ${ref.kind}, ${ref.id}, ${ref.mime}, ${ref.fileName}, ${ref.caption}) on conflict (message_id) do nothing`);
  await db.execute(sql`update conversations set last_preview = ${preview.slice(0, 120)}, last_message_at = greatest(coalesce(last_message_at, ${ts.toISOString()}::timestamptz), ${ts.toISOString()}::timestamptz),
    window_expires_at = greatest(coalesce(window_expires_at, ${ts.toISOString()}::timestamptz), ${new Date(ts.getTime() + 24 * 3600_000).toISOString()}::timestamptz), unread = unread + 1, status = 'open' where id = ${convId} and tenant_id = ${tenantId}`);

  // Click-to-WhatsApp: the first message of an ad click carries the ad. A failure here must never lose the customer's message.
  if (m.referral && typeof m.referral === 'object') await recordAdClick(db, tenantId, contactId, convId, phone, profile, m.referral).catch((e: Error) => console.error('[leads] ad click', e.message));

  // Attribution: a customer's reply counts for the most recent campaign message they received in the last 7 days, once.
  await db.execute(sql`
    update campaign_recipients set state = 'replied'
    where id = (select id from campaign_recipients where tenant_id = ${tenantId} and contact_id = ${contactId} and state in ('sent','delivered','read') and sent_at > now() - interval '7 days' order by sent_at desc limit 1)
      and tenant_id = ${tenantId}`);

  let optedOut = false, autoReply: string | undefined;
  const isStopButton = m.type === 'button' && /^STOP:/i.test(m.button?.payload ?? '');
  if (isStopText(text) || isStopButton) {
    const r = rows(await db.execute(sql`update contacts set consent_status = 'stopped', opt_out_at = now(), opt_out_source = ${isStopButton ? 'button' : 'stop_keyword'}, updated_at = now() where id = ${contactId} and tenant_id = ${tenantId} and consent_status <> 'stopped' returning id`));
    if (r[0]) await db.execute(sql`insert into contact_consent_events (tenant_id, contact_id, action, source, note) values (${tenantId}, ${contactId}, 'opt_out', ${isStopButton ? 'button' : 'keyword'}, ${`Customer wrote: ${text.slice(0, 40)}`})`);
    optedOut = true;
    await stopRunsFor(db, tenantId, contactId, 'opted_out');
    autoReply = 'You will no longer receive promotional messages from us. Reply START to subscribe again.';
  } else if (isStartText(text) && String(c.consent_status) === 'stopped') {
    // Resume only when the customer themself asks, and record it.
    await db.execute(sql`update contacts set consent_status = 'allowed', consent_source = 'WhatsApp chat', consent_at = now(), opt_out_at = null, updated_at = now() where id = ${contactId} and tenant_id = ${tenantId}`);
    await db.execute(sql`insert into contact_consent_events (tenant_id, contact_id, action, source, note) values (${tenantId}, ${contactId}, 'resume', 'keyword', 'Customer wrote START')`);
    autoReply = 'Welcome back. You will receive our messages again. Reply STOP any time to opt out.';
  } else {
    const rules = rows(await db.execute(sql`select id, keywords, reply from automation_rules where tenant_id = ${tenantId} and active = true and kind = 'keyword'`));
    const lower = text.toLowerCase();
    const hit = rules.find((r) => (r.keywords as string[]).some((k) => k && lower.includes(k.toLowerCase())));
    if (hit) { autoReply = String(hit.reply); await db.execute(sql`update automation_rules set hits = hits + 1 where id = ${hit.id} and tenant_id = ${tenantId}`); }
  }
  // The reply is queued like any other message: the sender re-checks everything and the worker's queue delivers it. Only this
  // one acknowledgement may go to a person who just opted out (they asked for it, and it tells them how to come back).
  if (autoReply) {
    await db.execute(sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status, phone_number_id, payload)
      values (${tenantId}, ${convId}, 'out', 'auto', ${autoReply}, 'queued', ${phoneNumberId}, ${JSON.stringify(optedOut ? { ack: 'opt_out' } : {})}::jsonb)`);
  }
  return { outcome: 'ok', autoReply, optedOut };
}

interface TemplateStatusPayload { event?: string; message_template_id?: number | string; message_template_name?: string; message_template_language?: string; reason?: string; message_template_category?: string; other_info?: { title?: string }; disable_info?: unknown }

/** message_template_status_update (spec 5.5). PAUSED backs off 3 h, then 6 h; DISABLED is terminal. */
export async function handleTemplateStatus(db: Db, tenantId: string, v: TemplateStatusPayload): Promise<Outcome> {
  const name = v.message_template_name, lang = v.message_template_language;
  if (!name) return 'ignored';
  const ev = String(v.event ?? '').toUpperCase();
  const t = rows(await db.execute(sql`select id, pause_count from templates where tenant_id = ${tenantId} and name = ${name} and (${lang ?? null}::text is null or language = ${lang ?? ''} or language = split_part(${lang ?? ''}, '_', 1)) limit 1`))[0];
  if (!t) return 'ignored';
  const id = String(t.id);
  const metaId = v.message_template_id !== undefined ? String(v.message_template_id) : null;
  if (ev === 'APPROVED' || ev === 'REINSTATED' || ev === 'UNPAUSE') {
    await db.execute(sql`update templates set status = 'approved', rejection_reason = null, paused_until = null, meta_template_id = coalesce(${metaId}, meta_template_id), category_current = coalesce(${v.message_template_category?.toLowerCase() ?? null}, category_current), updated_at = now() where id = ${id} and tenant_id = ${tenantId}`);
    await db.execute(sql`update campaigns set status = 'scheduled', pause_reason = null where tenant_id = ${tenantId} and template_id = ${id} and status = 'paused' and pause_reason = 'template_paused'`);
  } else if (ev === 'REJECTED') {
    await db.execute(sql`update templates set status = 'rejected', rejection_reason = ${v.reason ?? 'NONE'}, meta_template_id = coalesce(${metaId}, meta_template_id), updated_at = now() where id = ${id} and tenant_id = ${tenantId}`);
  } else if (ev === 'PAUSED') {
    const hours = Number(t.pause_count) >= 1 ? 6 : 3;
    await db.execute(sql`update templates set status = 'paused', pause_count = pause_count + 1, paused_until = now() + (${hours} || ' hours')::interval, updated_at = now() where id = ${id} and tenant_id = ${tenantId}`);
    await db.execute(sql`update campaigns set status = 'paused', pause_reason = 'template_paused' where tenant_id = ${tenantId} and template_id = ${id} and status in ('scheduled','running')`);
  } else if (ev === 'DISABLED') {
    await db.execute(sql`update templates set status = 'disabled', updated_at = now() where id = ${id} and tenant_id = ${tenantId}`);
    await db.execute(sql`update campaigns set status = 'paused', pause_reason = 'template_disabled' where tenant_id = ${tenantId} and template_id = ${id} and status in ('scheduled','running')`);
  } else return 'ignored';
  return 'ok';
}

/** Account-level events that must stop sending (spec 5.5 account_update). */
export async function handleAccountUpdate(db: Db, tenantId: string, v: { event?: string }): Promise<Outcome> {
  const ev = String(v.event ?? '').toUpperCase();
  if (['ACCOUNT_RESTRICTION', 'ACCOUNT_VIOLATION', 'DISABLED_UPDATE'].includes(ev)) {
    await db.execute(sql`update meta_accounts set health_state = ${ev === 'ACCOUNT_RESTRICTION' ? 'restricted' : ev === 'DISABLED_UPDATE' ? 'disabled' : 'violation'}, restriction_info = ${JSON.stringify(v)}::jsonb, updated_at = now() where tenant_id = ${tenantId}`);
    await db.execute(sql`update campaigns set status = 'paused', pause_reason = 'account_restricted' where tenant_id = ${tenantId} and status in ('scheduled','running')`);
    return 'ok';
  }
  if (['PARTNER_REMOVED', 'PARTNER_APP_UNINSTALLED', 'ACCOUNT_DELETED'].includes(ev)) {
    await db.execute(sql`update meta_accounts set token_status = 'revoked', updated_at = now() where tenant_id = ${tenantId}`);
    await db.execute(sql`update tenants set status = 'offboarded', updated_at = now() where id = ${tenantId}`);
    await db.execute(sql`update campaigns set status = 'paused', pause_reason = 'disconnected' where tenant_id = ${tenantId} and status in ('scheduled','running')`);
    return 'ok';
  }
  return 'ignored';
}

export const _types = {} as { GraphError: GraphError };

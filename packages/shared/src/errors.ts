/**
 * Meta error policy (spec Part B section 6). Branch on the numeric code, never on the title or HTTP status.
 * Unknown codes are NOT guessed: they return policy 'unknown' so the caller sends the job to the dead-letter queue.
 *
 * retry: 'retry' = backoff; 'retry_delay' = after a stated delay; 'no' = do not retry; 'no_user' = never auto-retry for this user.
 * action: what the system does. hidden = never shown to the business owner.
 */
export type Retry = 'retry' | 'retry_delay' | 'no' | 'no_user';
export type Action =
  | 'pause_tenant' | 'reconnect' | 'alert_ops' | 'restricted' | 'block_country' | 'throttle' | 'delay_recipient' | 'pause_campaign_24h'
  | 'hold_contact_24h' | 'opt_out_contact' | 'unreachable' | 'skip' | 'fix_template' | 'resync_templates' | 'reroute_messages' | 'reroute_mm' | 'payment_banner'
  | 'register_number' | 'suggest_template' | 'dlq' | 'disable_number' | 'block_register' | 'noop' | 'info' | 'wait';

export interface ErrorPolicy {
  retry: Retry;
  action: Action;
  /** Backoff class from spec 4.5, used by the send worker. */
  backoff?: 'throughput' | 'pair' | 'maintenance' | 'transient' | 'mm_sync' | 'long';
  en: string | null;
  hi: string | null;
  known: boolean;
}

const P = (retry: Retry, action: Action, en: string | null, hi: string | null = null, backoff?: ErrorPolicy['backoff']): ErrorPolicy => ({ retry, action, en, hi, backoff, known: true });

const H = {
  190: 'Aapka WhatsApp connection expire ho gaya. Reconnect dabaiye.',
  368: 'Meta ne policy issue ki wajah se aapka account restrict kiya hai. Sending ruk gayi hai.',
  131048: 'Bahut logon ne recent messages block/report kiye. Number bachane ke liye sending ruki hai.',
  131026: 'Ye customer abhi WhatsApp message receive nahi kar sakta.',
  131042: 'Meta aapka card charge nahi kar paya. Meta mein payment method update kariye.',
  131047: 'Customer ke last message ko 24 ghante se zyada ho gaye. Approved template bhejiye.',
  131049: 'Meta ne aaj is customer ke marketing messages limit kiye. Charge nahi laga. 24 ghante baad try kariye.',
  131050: 'Is customer ne aapke promotional messages band kar diye hain.',
  132001: 'Ye template is language mein abhi approved nahi hai.',
  132015: 'Low quality ki wajah se Meta ne ye template pause kiya hai. Apne aap resume hoga.',
} as const;

const TOKEN = P('no', 'reconnect', 'Your WhatsApp connection expired. Tap Reconnect to continue.', H[190]);
const PERMISSION = P('no', 'reconnect', "We don't have permission for this action. Please reconnect WhatsApp.");
const PARAM = P('no', 'dlq', "This message couldn't be sent because of a setup error. Our team is notified.");
const TEMPLATE_PARAM = P('no', 'fix_template', "The message details don't match the message format. Check the variables.");
const TRANSIENT = P('retry', 'wait', "WhatsApp is temporarily unavailable. We'll retry.", null, 'transient');
const REG = P('no', 'info', 'Number setup needs attention.');

const TABLE: Record<number, ErrorPolicy> = {
  0: TOKEN, 190: TOKEN,
  3: PERMISSION, 10: PERMISSION, 131005: PERMISSION,
  368: P('no', 'restricted', 'Meta has restricted your WhatsApp account for a policy issue. Sending is paused.', H[368]),
  130497: P('no', 'block_country', "Meta doesn't allow messages to this country from your account."),
  131031: P('no', 'alert_ops', 'Your WhatsApp account is locked by Meta. Contact support.'),
  4: P('retry', 'throttle', null, null, 'throughput'),
  80007: P('retry', 'throttle', null, null, 'throughput'),
  130429: P('retry', 'throttle', null, null, 'throughput'),
  131048: P('no', 'pause_campaign_24h', 'Too many people blocked or reported recent messages. Sending is paused to protect your number.', H[131048]),
  131056: P('retry_delay', 'delay_recipient', null, null, 'pair'),
  133016: P('retry_delay', 'block_register', 'Too many setup attempts. Try again in 3 days.', null, 'long'),
  1: P('retry', 'dlq', 'Something went wrong. We\'re retrying.', null, 'transient'),
  2: TRANSIENT, 131016: TRANSIENT, 131000: TRANSIENT,
  33: P('no', 'disable_number', 'This WhatsApp number was removed from your account.'),
  100: PARAM, 131008: PARAM, 131009: PARAM,
  130472: P('no', 'skip', "Meta didn't deliver this to the customer (Meta test group). Not charged."),
  131021: P('no', 'skip', "You can't message your own business number."),
  131026: P('no', 'unreachable', "This customer can't receive WhatsApp messages right now.", H[131026]),
  131037: P('no', 'alert_ops', "Your business name isn't approved yet."),
  131042: P('no', 'payment_banner', "Meta couldn't charge your card. Update your payment method in Meta to continue.", H[131042]),
  131045: P('no', 'register_number', 'Your number setup is incomplete. Fixing…'),
  131047: P('no', 'suggest_template', "It's been over 24 hours since this customer messaged. Use an approved message format.", H[131047]),
  131049: P('retry_delay', 'hold_contact_24h', 'Meta limited marketing messages to this customer today. Not charged. Try after 24 hours.', H[131049]),
  131050: P('no_user', 'opt_out_contact', 'This customer turned off your promotional messages.', H[131050]),
  131051: P('no', 'fix_template', "This message type isn't supported."),
  131052: P('no', 'info', "Couldn't load the customer's file. Ask them to send it again."),
  131053: P('no', 'fix_template', "This file type or size isn't allowed."),
  131055: P('no', 'reroute_messages', null), 134100: P('no', 'reroute_messages', null),
  131057: P('retry', 'wait', null, null, 'maintenance'),
  131060: P('no', 'info', "A message from this customer couldn't be shown."),
  131062: P('no', 'info', "This message needs the customer's phone number."),
  131063: P('no', 'reroute_mm', null),
  131064: P('retry_delay', 'pause_tenant', 'Meta temporarily limited your messages because message formats were in the wrong category.', null, 'long'),
  132000: TEMPLATE_PARAM, 132005: TEMPLATE_PARAM, 132012: TEMPLATE_PARAM, 132018: TEMPLATE_PARAM,
  132001: P('no', 'resync_templates', "This message format isn't approved in this language yet.", H[132001]),
  132007: P('no', 'fix_template', 'This message format breaks WhatsApp rules. Please edit it.'),
  132015: P('no', 'pause_campaign_24h', 'This message format is paused by Meta for low quality. It resumes automatically.', H[132015]),
  132016: P('no', 'fix_template', 'This message format was disabled by Meta. Create a new one.'),
  132068: P('no', 'fix_template', "This form can't be sent right now."),
  132069: P('retry_delay', 'wait', "This form can't be sent right now."),
  2388019: P('no', 'fix_template', "You've reached Meta's message format limit. Delete unused ones."),
  2388024: P('no', 'fix_template', 'A message format with this name already exists.'),
  134101: P('retry_delay', 'wait', null, null, 'mm_sync'),
  134102: P('no', 'info', "Marketing setup isn't finished on Meta."),
  1752041: P('no', 'noop', null),
  133000: REG, 133005: REG, 133006: REG, 133008: P('retry_delay', 'info', 'Number setup needs attention.'), 133009: P('retry_delay', 'info', 'Number setup needs attention.'), 133010: REG, 133015: P('retry_delay', 'info', 'Number setup needs attention.'),
  2593107: P('no', 'info', "Chat history import didn't complete."), 2593108: P('no', 'info', "Chat history import didn't complete."), 2593109: P('no', 'info', "Chat history import didn't complete."),
  // 470 = legacy re-engagement; the spec treats it as 131047 and marks this [INFERRED].
  470: P('no', 'suggest_template', "It's been over 24 hours since this customer messaged. Use an approved message format.", H[131047]),
};
// 200–299 are permission errors (spec: "200–299").
for (let c = 200; c <= 299; c++) TABLE[c] ??= PERMISSION;
// 2494100 and 133004 share the maintenance backoff with 131057 (spec 4.5).
TABLE[2494100] = P('retry', 'wait', null, null, 'maintenance');
TABLE[133004] = P('retry', 'wait', null, null, 'maintenance');

const UNKNOWN: ErrorPolicy = { retry: 'no', action: 'dlq', en: 'Something went wrong on our side. Our team has been told.', hi: null, known: false };

export function errorPolicy(code: number | string | null | undefined): ErrorPolicy {
  const n = typeof code === 'string' ? Number(code) : code;
  if (n === null || n === undefined || Number.isNaN(n)) return UNKNOWN;
  return TABLE[n] ?? UNKNOWN;
}

/** Backoff delay in ms for a send attempt (spec 4.5). Jitter is added by the caller. Returns null when the policy is not retried by delay. */
export function backoffMs(policy: ErrorPolicy, attempt: number): number | null {
  if (policy.retry === 'no' || policy.retry === 'no_user') return null;
  switch (policy.backoff) {
    case 'throughput': return Math.min(60_000, 1000 * 2 ** attempt);
    case 'pair': return attempt >= 5 ? null : 4 ** attempt * 1000; // 1, 4, 16, 64, 256 s then fail
    case 'maintenance': return [30_000, 60_000, 120_000][Math.min(attempt, 2)]!;
    case 'transient': return attempt >= 5 ? null : 5000 * 3 ** attempt; // 5 attempts, then dead-letter
    case 'mm_sync': return attempt >= 3 ? null : 10 * 60_000;
    case 'long': return 6 * 3_600_000;
    default: return null;
  }
}

/** Shape of a synchronous Graph error body (spec 6). */
export interface GraphError { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string; is_transient?: boolean; error_data?: { details?: string } }

/**
 * Message payload builders and endpoint routing (spec section 4). Shapes follow spec 4.1 to 4.3; anything the spec marks
 * [INFERRED] or [UNVERIFIED] is kept minimal and called out in a comment instead of guessed.
 */
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface TemplateParam { type: 'text'; text: string; parameter_name?: string }
export interface TemplateComponent { type: 'header' | 'body' | 'button' | 'limited_time_offer'; sub_type?: 'url' | 'quick_reply' | 'copy_code'; index?: string | number; parameters: unknown[] }

const envelope = (to: string, callbackData?: string) => ({
  messaging_product: 'whatsapp' as const,
  recipient_type: 'individual' as const,
  to,
  ...(callbackData ? { biz_opaque_callback_data: callbackData } : {}),
});

/**
 * Always E.164 with the country code (spec 4.1). If the country code is missing Meta prepends the BUSINESS number's code,
 * so callers must pass an already-normalised number. We refuse anything else rather than send to a wrong country.
 */
export function assertE164(to: string): string {
  if (!/^\+[1-9]\d{7,14}$/.test(to)) throw new Error('Recipient must be in E.164 format, for example +919876543210');
  return to;
}

/** Template send. `callbackId` becomes biz_opaque_callback_data = msg:<id> so status webhooks can join before the wamid is saved (spec 4.1, [INFERRED] field). */
export function templateMessage(opts: { to: string; name: string; language: string; components?: TemplateComponent[]; messageId?: string }) {
  return {
    ...envelope(assertE164(opts.to), opts.messageId ? `msg:${opts.messageId}` : undefined),
    type: 'template' as const,
    template: { name: opts.name, language: { code: opts.language }, ...(opts.components?.length ? { components: opts.components } : {}) },
  };
}

/** Free-form text, only valid inside the 24-hour window. Limit 4096 characters (spec 4.2, [INFERRED]). */
export function textMessage(opts: { to: string; body: string; previewUrl?: boolean; messageId?: string; replyTo?: string }) {
  if (!opts.body.trim()) throw new Error('Message text is empty');
  if (opts.body.length > 4096) throw new Error('Message text is longer than 4096 characters');
  return {
    ...envelope(assertE164(opts.to), opts.messageId ? `msg:${opts.messageId}` : undefined),
    ...(opts.replyTo ? { context: { message_id: opts.replyTo } } : {}),
    type: 'text' as const,
    text: { body: opts.body, ...(opts.previewUrl ? { preview_url: true } : {}) },
  };
}

/**
 * A picture, video or document typed into a chat (inside the 24-hour window). The file is sent by the media id from uploading it to THIS number.
 * Only documents carry a file name, and only pictures, videos and documents carry a caption (WhatsApp rejects a caption on anything else).
 */
export function mediaMessage(opts: { to: string; kind: 'image' | 'video' | 'document'; mediaId: string; caption?: string | null; fileName?: string | null; messageId?: string }) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(opts.mediaId)) throw new Error('Media id is not valid');
  const caption = (opts.caption ?? '').trim();
  if (caption.length > 1024) throw new Error('Caption is longer than 1024 characters');
  return {
    ...envelope(assertE164(opts.to), opts.messageId ? `msg:${opts.messageId}` : undefined),
    type: opts.kind,
    [opts.kind]: { id: opts.mediaId, ...(caption ? { caption } : {}), ...(opts.kind === 'document' && opts.fileName ? { filename: opts.fileName } : {}) },
  };
}

/** Body parameters for a template. Pass `names` for NAMED format; omit for POSITIONAL ({{1}}, {{2}} in order). */
export function bodyParams(values: string[], names?: string[]): TemplateComponent {
  return { type: 'body', parameters: values.map((text, i) => ({ type: 'text', text, ...(names?.[i] ? { parameter_name: names[i] } : {}) })) };
}

/** URL button suffix variable. Spec: percent-encode the value. */
export function urlButtonParam(index: number, value: string): TemplateComponent {
  return { type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: encodeURIComponent(value) }] };
}

/** Quick-reply payload, e.g. STOP:c_456 so an inbound button tap can be mapped to an opt-out. Spec marks the shape [INFERRED]. */
export function quickReplyParam(index: number, payload: string): TemplateComponent {
  return { type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] };
}

export type Endpoint = 'messages' | 'marketing_messages';
export interface RouteInput { type: 'template' | 'text' | string; categoryCurrent?: TemplateCategory; sendPolicy?: 'mm_fallback' | 'mm_strict'; now?: Date; strictFrom?: Date }
/** Marketing Messages API sunsets Cloud API marketing sends on 2027-10-13 (spec 0.3). Kept as a config value, not a literal in logic. */
export const DEFAULT_STRICT_FROM = new Date('2027-10-13T00:00:00Z');

/** chooseEndpoint (spec 4.3). Marketing templates go to /marketing_messages; everything else to /messages. */
export function chooseEndpoint(i: RouteInput): { endpoint: Endpoint; productPolicy?: 'CLOUD_API_FALLBACK' | 'STRICT' } {
  if (i.type === 'template' && i.categoryCurrent === 'MARKETING') {
    const strict = i.sendPolicy === 'mm_strict' || (i.now ?? new Date()) >= (i.strictFrom ?? DEFAULT_STRICT_FROM);
    return { endpoint: 'marketing_messages', productPolicy: strict ? 'STRICT' : 'CLOUD_API_FALLBACK' };
  }
  return { endpoint: 'messages' };
}

/** Marketing sends add product_policy to the body (spec 4.3). */
export function withProductPolicy<T extends object>(body: T, policy: 'CLOUD_API_FALLBACK' | 'STRICT') { return { ...body, product_policy: policy }; }

/** Router reaction to a synchronous error code (spec 4.3). */
export function rerouteFor(code: number | undefined): Endpoint | null {
  if (code === 131063) return 'marketing_messages'; // template was reclassified as marketing
  if (code === 131055 || code === 134100) return 'messages'; // template is no longer marketing
  return null;
}

/**
 * Header media for a template send. Meta recommends sending the id of media uploaded to the sending number (links also work but cost a public fetch).
 * Documents carry a file name. Shape: components[].type "header", parameters[].type image|video|document with an id (Meta "Template media" docs).
 */
export function headerMediaParam(kind: 'image' | 'video' | 'document', mediaId: string, fileName?: string): TemplateComponent {
  if (!/^\d{5,30}$/.test(mediaId)) throw new Error('Header media id looks wrong');
  const media: Record<string, string> = { id: mediaId };
  if (kind === 'document' && fileName) media.filename = fileName.slice(0, 120);
  return { type: 'header', parameters: [{ type: kind, [kind]: media }] };
}

/** Copy-code button. The code is sent with every message (Meta: coupon_code, up to 15 characters). `index` is the button's position in the template. */
export function copyCodeParam(index: number, code: string): TemplateComponent {
  const c = code.trim();
  if (!c || c.length > 15) throw new Error('A copy-code button needs a code of 1 to 15 characters');
  return { type: 'button', sub_type: 'copy_code', index: String(index), parameters: [{ type: 'coupon_code', coupon_code: c }] };
}

/** The countdown of a limited-time offer, given per message as a Unix time in milliseconds (Meta: limited_time_offer.expiration_time_ms). */
export function limitedTimeOfferParam(expirationMs: number): TemplateComponent {
  if (!Number.isSafeInteger(expirationMs) || expirationMs <= 0) throw new Error('The offer expiry time looks wrong');
  return { type: 'limited_time_offer', parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: expirationMs } }] };
}

/**
 * Files customers send us (P8). Pure rules, so what is stored, shown and served is tested.
 * A customer controls every byte they send, so nothing here trusts the type they claim: only a short list of safe types is ever shown inline,
 * everything else is offered as a download and served so the browser cannot run it.
 */
export const MEDIA_KINDS = ['image', 'audio', 'video', 'document', 'sticker'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MAX_INBOUND_BYTES = 16 * 1024 * 1024;   // matches the database limit for template files
export const MAX_ATTEMPTS = 5;

export function mediaKindOf(type: string | undefined): MediaKind | null { return (MEDIA_KINDS as readonly string[]).includes(type ?? '') ? (type as MediaKind) : null; }

const KIND_WORD: Record<MediaKind, string> = { image: 'Photo', audio: 'Voice message', video: 'Video', document: 'Document', sticker: 'Sticker' };
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

interface InboundLike { type?: string; location?: { name?: string; address?: string; latitude?: number; longitude?: number }; contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[]; [k: string]: unknown }

/** The one line a conversation list and a chat bubble show for a message that is not plain text. Never empty. */
export function previewFor(m: InboundLike): string {
  const k = mediaKindOf(m.type);
  if (k) { const o = (m[k] ?? {}) as { caption?: string; filename?: string }; const cap = clean(o.caption, 300); const name = k === 'document' ? clean(o.filename, 80) : '';
    return cap ? `${KIND_WORD[k]}: ${cap}` : name ? `${KIND_WORD[k]}: ${name}` : `[${KIND_WORD[k]}]`; }
  if (m.type === 'location') { const l = m.location ?? {}; const where = clean([l.name, l.address].filter(Boolean).join(', '), 200) || (Number.isFinite(l.latitude) && Number.isFinite(l.longitude) ? `${l.latitude}, ${l.longitude}` : '');
    return where ? `Location: ${where}` : '[Location]'; }
  if (m.type === 'contacts') { const c = (m.contacts ?? []).map((x) => clean(x.name?.formatted_name, 60) + (x.phones?.[0]?.phone ? ` ${clean(x.phones[0].phone, 20)}` : '')).filter(Boolean).slice(0, 3).join('; ');
    return c ? `Contact: ${c}` : '[Contact]'; }
  if (m.type === 'order') return '[Order]';
  if (m.type === 'unsupported') return '[This message type is not supported by WhatsApp Business yet]';
  return m.type ? `[${clean(m.type, 20)}]` : '[message]';
}

/** What Meta gave us about the file: its id, and (as hints only) the type, caption and file name. */
export function mediaRefOf(m: InboundLike): { kind: MediaKind; id: string; mime: string | null; caption: string | null; fileName: string | null } | null {
  const kind = mediaKindOf(m.type); if (!kind) return null;
  const o = (m[kind] ?? {}) as { id?: unknown; mime_type?: unknown; caption?: unknown; filename?: unknown };
  const id = typeof o.id === 'string' ? o.id.trim() : typeof o.id === 'number' ? String(o.id) : '';
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id)) return null;   // goes into a URL path, so keep it to a safe shape
  return { kind, id, mime: typeof o.mime_type === 'string' ? clean(o.mime_type, 100).toLowerCase() : null, caption: clean(o.caption, 1000) || null, fileName: clean(o.filename, 120) || null };
}

/** Types a browser may show inside the chat. Anything else (HTML, SVG, scripts, unknown) is only ever a download. */
const INLINE: Record<string, MediaKind[]> = {
  'image/jpeg': ['image', 'sticker'], 'image/png': ['image', 'sticker'], 'image/webp': ['image', 'sticker'],
  'audio/ogg': ['audio'], 'audio/mpeg': ['audio'], 'audio/mp4': ['audio'], 'audio/aac': ['audio'], 'audio/amr': ['audio'],
  'video/mp4': ['video'], 'video/3gpp': ['video'],
};
export function canShowInline(mime: string | null | undefined, kind: string): boolean { return !!mime && (INLINE[mime.toLowerCase()] ?? []).includes(kind as MediaKind); }

/** How to serve a stored file: shown in the page only when the type is on the safe list for that kind of message. */
export function serveAs(mime: string | null, kind: string, fileName: string | null): { contentType: string; disposition: string } {
  const safeName = (fileName || KIND_WORD[kind as MediaKind] || 'file').replace(/[^\w. -]/g, '_').slice(0, 80) || 'file';
  if (canShowInline(mime, kind)) return { contentType: mime!.toLowerCase(), disposition: `inline; filename="${safeName}"` };
  return { contentType: 'application/octet-stream', disposition: `attachment; filename="${safeName}"` };
}

/** Minutes to wait before the next try. Waits grow, so a Meta hiccup is ridden out without hammering it. */
export function retryDelayMs(attempts: number): number { return [30_000, 2 * 60_000, 10 * 60_000, 45 * 60_000, 3 * 3600_000][Math.min(Math.max(attempts, 1), 5) - 1]!; }
/** A 4xx other than "too many requests" means the file is gone or the link is bad: asking again will not help. */
export function isPermanentFailure(status: number | undefined): boolean { return !!status && status >= 400 && status < 500 && status !== 429 && status !== 408; }

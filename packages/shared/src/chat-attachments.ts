/**
 * Files the team sends to a customer from the chat. Pure rules, so what WhatsApp will accept is checked before anything is stored or queued.
 * The type comes from the file's own bytes, never from its name or the type the browser claims.
 */
import { MEDIA_LIMITS, safeFileName, sizeLabel, sniff, type MediaKind } from './template-media';

export const MAX_CAPTION = 1024;   // WhatsApp's limit for a photo, video or document caption

export type AttachmentCheck =
  | { ok: true; kind: MediaKind; mime: string; ext: string; size: number; fileName: string; caption: string | null }
  | { ok: false; error: string };

const NOUN = { image: 'picture', video: 'video', document: 'PDF' } as const;

export function checkChatAttachment(bytes: Uint8Array, originalName: string, caption: unknown): AttachmentCheck {
  if (!bytes.length) return { ok: false, error: 'That file is empty.' };
  const real = sniff(bytes);
  if (!real) return { ok: false, error: 'WhatsApp can only send a JPEG or PNG picture, an MP4 video or a PDF. Choose one of those.' };
  const lim = MEDIA_LIMITS[real.kind];
  if (bytes.length > lim.maxBytes) return { ok: false, error: `This ${NOUN[real.kind]} is ${sizeLabel(bytes.length)}. WhatsApp allows up to ${lim.maxBytes / 1048576} MB. Choose a smaller one.` };
  const cap = typeof caption === 'string' ? caption.replace(/\r\n/g, '\n').trim() : '';
  if (cap.length > MAX_CAPTION) return { ok: false, error: `The caption can be ${MAX_CAPTION.toLocaleString('en-IN')} characters at most. This one is ${cap.length}.` };
  return { ok: true, kind: real.kind, mime: real.mime, ext: real.ext, size: bytes.length, fileName: safeFileName(originalName || 'file', real.ext).replace(/^header\./, `${NOUN[real.kind]}.`), caption: cap || null };
}

/** The line the conversation list and the chat show for a file we sent. */
export function attachmentPreview(kind: string, caption: string | null, fileName: string): string {
  const word = kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : 'Document';
  return caption ? `${word}: ${caption}` : kind === 'document' ? `${word}: ${fileName}` : `[${word}]`;
}

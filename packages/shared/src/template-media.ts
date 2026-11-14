/**
 * Header media for templates: what WhatsApp accepts, checked from the file's own bytes (never from the name or the type the browser claims).
 * Limits follow Meta's media documentation: images JPEG/PNG up to 5 MB, video MP4 up to 16 MB, documents PDF. Template sample uploads (Resumable
 * Upload) accept exactly these four types: image/jpeg, image/png, video/mp4, application/pdf.
 */
export type MediaKind = 'image' | 'video' | 'document';
export const MEDIA_LIMITS: Record<MediaKind, { mime: string[]; maxBytes: number; label: string }> = {
  image: { mime: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024, label: 'a JPEG or PNG picture up to 5 MB' },
  video: { mime: ['video/mp4'], maxBytes: 16 * 1024 * 1024, label: 'an MP4 video up to 16 MB' },
  document: { mime: ['application/pdf'], maxBytes: 16 * 1024 * 1024, label: 'a PDF up to 16 MB' },
};

export type MediaCheck = { ok: true; kind: MediaKind; mime: string; ext: string; size: number } | { ok: false; error: string };

/** What the file really is, from its first bytes. */
export function sniff(b: Uint8Array): { kind: MediaKind; mime: string; ext: string } | null {
  const at = (i: number) => b[i];
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (b.length >= 12 && at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) return { kind: 'video', mime: 'video/mp4', ext: 'mp4' }; // 'ftyp' box
  if (b.length >= 5 && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return { kind: 'document', mime: 'application/pdf', ext: 'pdf' };
  return null;
}

/** Checks a chosen file against the header type the owner picked. The message says what to do next. */
export function checkHeaderMedia(bytes: Uint8Array, wanted: MediaKind): MediaCheck {
  const lim = MEDIA_LIMITS[wanted];
  if (bytes.length === 0) return { ok: false, error: 'That file is empty.' };
  const real = sniff(bytes);
  if (!real) return { ok: false, error: `WhatsApp cannot use this file. Choose ${lim.label}.` };
  const noun = { image: 'a picture', video: 'a video', document: 'a PDF' } as const;
  if (real.kind !== wanted) return { ok: false, error: `This file is ${noun[real.kind]}, but you chose a ${wanted === 'image' ? 'picture' : wanted === 'document' ? 'PDF' : 'video'} header. Choose the matching header type, or pick another file.` };
  if (bytes.length > lim.maxBytes) return { ok: false, error: `This file is ${sizeLabel(bytes.length)}, and the limit is ${lim.maxBytes / 1048576} MB. Choose ${lim.label}.` };
  return { ok: true, kind: real.kind, mime: real.mime, ext: real.ext, size: bytes.length };
}

/** "5.01 MB" when it is just over a whole number of MB, otherwise one decimal, so "5.0 MB, limit 5 MB" can never happen. */
export function sizeLabel(bytes: number): string {
  const mb = bytes / 1048576;
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const one = Math.round(mb * 10) / 10;
  return Number.isInteger(one) && mb > one ? `${mb.toFixed(2)} MB` : `${one} MB`;
}

/** A safe display/upload file name: no paths, no control characters, never empty. */
export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/]/g, ' ').replace(/[\u0000-\u001f\u007f"<>|?*:]/g, '').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/^\.+/, '').slice(0, 60).trim();
  return `${base || 'header'}.${ext}`;
}

import { describe, expect, it } from 'vitest';
import { MAX_CAPTION, attachmentPreview, checkChatAttachment } from '../src/chat-attachments';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const big = (head: Uint8Array, n: number) => { const b = new Uint8Array(n); b.set(head); return b; };

describe('checkChatAttachment: what the team may send to a customer', () => {
  it('accepts a picture, a video and a PDF, and says which it is from the bytes', () => {
    expect(checkChatAttachment(PNG, 'a.png', '')).toMatchObject({ ok: true, kind: 'image', mime: 'image/png' });
    expect(checkChatAttachment(JPG, 'a.jpg', '')).toMatchObject({ ok: true, kind: 'image', mime: 'image/jpeg' });
    expect(checkChatAttachment(MP4, 'a.mp4', '')).toMatchObject({ ok: true, kind: 'video', mime: 'video/mp4' });
    expect(checkChatAttachment(PDF, 'q.pdf', '')).toMatchObject({ ok: true, kind: 'document', mime: 'application/pdf' });
  });
  it('trusts the bytes, never the name: an HTML or script file renamed .jpg is refused', () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect(checkChatAttachment(html, 'photo.jpg', '').ok).toBe(false);
    expect(checkChatAttachment(new TextEncoder().encode('MZ\x90\x00 exe'), 'invoice.pdf', '').ok).toBe(false);
    expect(checkChatAttachment(PNG, 'evil.exe', '')).toMatchObject({ ok: true, kind: 'image' });   // really a picture, so the name does not matter
  });
  it('refuses empty files and types WhatsApp cannot send, with a clear message', () => {
    expect(checkChatAttachment(new Uint8Array(0), 'a.png', '')).toEqual({ ok: false, error: 'That file is empty.' });
    const r = checkChatAttachment(new TextEncoder().encode('hello'), 'a.txt', ''); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/JPEG or PNG.*MP4.*PDF/);
  });
  it('enforces WhatsApp size limits per kind: 5 MB pictures, 16 MB videos and PDFs', () => {
    expect(checkChatAttachment(big(PNG, 5 * 1048576), 'a.png', '').ok).toBe(true);
    const over = checkChatAttachment(big(PNG, 5 * 1048576 + 1), 'a.png', ''); expect(over.ok).toBe(false); if (!over.ok) expect(over.error).toMatch(/picture.*5 MB/);
    expect(checkChatAttachment(big(MP4, 16 * 1048576), 'a.mp4', '').ok).toBe(true);
    expect(checkChatAttachment(big(MP4, 16 * 1048576 + 1), 'a.mp4', '').ok).toBe(false);
    expect(checkChatAttachment(big(PDF, 16 * 1048576), 'a.pdf', '').ok).toBe(true);
    expect(checkChatAttachment(big(PDF, 16 * 1048576 + 1), 'a.pdf', '').ok).toBe(false);
  });
  it('caption: trimmed, optional, 1,024 characters at most, line breaks kept', () => {
    expect(checkChatAttachment(PNG, 'a.png', '  hello  ')).toMatchObject({ ok: true, caption: 'hello' });
    expect(checkChatAttachment(PNG, 'a.png', '   ')).toMatchObject({ ok: true, caption: null });
    expect(checkChatAttachment(PNG, 'a.png', undefined)).toMatchObject({ ok: true, caption: null });
    expect(checkChatAttachment(PNG, 'a.png', 'a\r\nb')).toMatchObject({ caption: 'a\nb' });
    expect(checkChatAttachment(PNG, 'a.png', 'x'.repeat(MAX_CAPTION)).ok).toBe(true);
    const long = checkChatAttachment(PNG, 'a.png', 'x'.repeat(MAX_CAPTION + 1)); expect(long.ok).toBe(false); if (!long.ok) expect(long.error).toMatch(/1,024/);
    expect(checkChatAttachment(PNG, 'a.png', 42 as never)).toMatchObject({ ok: true, caption: null });   // not a string: ignored, never crashes
  });
  it('the file name is safe and never empty, with the right ending', () => {
    const n = (name: string) => { const r = checkChatAttachment(PDF, name, ''); return r.ok ? r.fileName : 'REFUSED'; };
    expect(n('Quote March.pdf')).toBe('Quote March.pdf');
    expect(n('../../etc/passwd')).toMatch(/^[^/\\]+\.pdf$/);
    expect(n('a"b<c>|d?.pdf')).not.toMatch(/["<>|?]/);
    expect(n('')).toMatch(/\.pdf$/); expect(n('x\r\nSet-Cookie: a=b.pdf')).not.toMatch(/[\r\n]/);
    expect(n('x'.repeat(500) + '.pdf').length).toBeLessThan(70);
  });
});

describe('attachmentPreview', () => {
  it('caption first, then the file name for documents, otherwise a plain label', () => {
    expect(attachmentPreview('image', 'Your saree', 'a.png')).toBe('Photo: Your saree');
    expect(attachmentPreview('image', null, 'a.png')).toBe('[Photo]');
    expect(attachmentPreview('video', null, 'a.mp4')).toBe('[Video]');
    expect(attachmentPreview('document', null, 'Quote.pdf')).toBe('Document: Quote.pdf');
    expect(attachmentPreview('document', 'See page 2', 'Quote.pdf')).toBe('Document: See page 2');
  });
});

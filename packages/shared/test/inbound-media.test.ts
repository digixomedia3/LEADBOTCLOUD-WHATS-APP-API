import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, canShowInline, isPermanentFailure, mediaKindOf, mediaRefOf, previewFor, retryDelayMs, serveAs } from '../src/inbound-media';

describe('previewFor: one honest line for anything that is not text', () => {
  it('names the kind, and prefers the caption, then the file name', () => {
    expect(previewFor({ type: 'image', image: {} } as never)).toBe('[Photo]');
    expect(previewFor({ type: 'image', image: { caption: 'my receipt' } } as never)).toBe('Photo: my receipt');
    expect(previewFor({ type: 'document', document: { filename: 'quote.pdf' } } as never)).toBe('Document: quote.pdf');
    expect(previewFor({ type: 'document', document: { filename: 'quote.pdf', caption: 'see this' } } as never)).toBe('Document: see this');
    expect(previewFor({ type: 'audio', audio: {} } as never)).toBe('[Voice message]');
    expect(previewFor({ type: 'sticker', sticker: {} } as never)).toBe('[Sticker]');
  });
  it('location and contact cards read clearly, and fall back to coordinates or a plain label', () => {
    expect(previewFor({ type: 'location', location: { name: 'Shop', address: 'Sector 62' } })).toBe('Location: Shop, Sector 62');
    expect(previewFor({ type: 'location', location: { latitude: 28.6, longitude: 77.2 } })).toBe('Location: 28.6, 77.2');
    expect(previewFor({ type: 'location', location: {} })).toBe('[Location]');
    expect(previewFor({ type: 'contacts', contacts: [{ name: { formatted_name: 'Asha' }, phones: [{ phone: '+91 98' }] }] })).toBe('Contact: Asha +91 98');
    expect(previewFor({ type: 'contacts', contacts: [] })).toBe('[Contact]');
  });
  it('never empty, never carries control characters, never huge', () => {
    expect(previewFor({})).toBe('[message]');
    expect(previewFor({ type: 'unsupported' })).toMatch(/not supported/);
    expect(previewFor({ type: 'image', image: { caption: 'a\u0000b\nc' } } as never)).toBe('Photo: a b c');
    expect(previewFor({ type: 'image', image: { caption: 'x'.repeat(5000) } } as never).length).toBeLessThanOrEqual(310);
  });
});

describe('mediaRefOf: only a safe id leaves this function', () => {
  it('reads the id, and keeps the type only as a hint', () => {
    expect(mediaRefOf({ type: 'image', image: { id: 'abc123', mime_type: 'IMAGE/JPEG', caption: ' hi ' } } as never)).toEqual({ kind: 'image', id: 'abc123', mime: 'image/jpeg', caption: 'hi', fileName: null });
  });
  it('refuses ids that could climb out of a URL path, are empty or are not text', () => {
    for (const id of ['../x', 'a/b', 'a?b=1', 'a b', '', 'x'.repeat(200), '%2e%2e', 'a#b']) expect(mediaRefOf({ type: 'image', image: { id } } as never)).toBeNull();
    expect(mediaRefOf({ type: 'image', image: {} } as never)).toBeNull();
    expect(mediaRefOf({ type: 'text' } as never)).toBeNull();
    expect(mediaRefOf({ type: 'location' } as never)).toBeNull();
  });
  it('mediaKindOf accepts only the five kinds', () => { expect(mediaKindOf('image')).toBe('image'); for (const x of ['location', 'text', '', undefined, 'IMAGE']) expect(mediaKindOf(x as never)).toBeNull(); });
});

describe('serving a file a stranger sent', () => {
  it('shows pictures, voice notes and videos of the right kind inline', () => {
    expect(canShowInline('image/jpeg', 'image')).toBe(true); expect(canShowInline('image/webp', 'sticker')).toBe(true);
    expect(canShowInline('audio/ogg', 'audio')).toBe(true); expect(canShowInline('video/mp4', 'video')).toBe(true);
  });
  it('never shows dangerous or mismatched types inline: HTML, SVG, JavaScript, PDF, or an image claimed to be audio', () => {
    for (const mime of ['text/html', 'image/svg+xml', 'application/javascript', 'application/pdf', 'application/octet-stream', 'text/plain', null, '']) expect(canShowInline(mime as never, 'image')).toBe(false);
    expect(canShowInline('image/jpeg', 'audio')).toBe(false); expect(canShowInline('audio/ogg', 'image')).toBe(false); expect(canShowInline('video/mp4', 'document')).toBe(false);
    expect(canShowInline('image/jpeg', 'document')).toBe(false);
  });
  it('anything not on the list downloads, as an opaque type, with a safe file name', () => {
    expect(serveAs('image/svg+xml', 'image', 'x.svg')).toEqual({ contentType: 'application/octet-stream', disposition: 'attachment; filename="x.svg"' });
    expect(serveAs('application/pdf', 'document', 'q.pdf').disposition).toMatch(/^attachment/);
    expect(serveAs(null, 'document', null).disposition).toBe('attachment; filename="Document"');
    expect(serveAs('image/jpeg', 'image', 'a.jpg').disposition).toBe('inline; filename="a.jpg"');
    expect(serveAs('IMAGE/JPEG', 'image', null).contentType).toBe('image/jpeg');
  });
  it('a hostile file name cannot break out of the header', () => {
    const d = serveAs('application/pdf', 'document', 'a"; filename=evil.html\r\nX-Evil: 1').disposition;
    expect(d).not.toMatch(/[\r\n]/); expect(d.match(/"/g)?.length).toBe(2);
  });
});

describe('retries', () => {
  it('waits grow and stop at five tries', () => {
    const w = [1, 2, 3, 4, 5].map(retryDelayMs); expect(w).toEqual([...w].sort((a, b) => a - b)); expect(new Set(w).size).toBe(5);
    expect(retryDelayMs(0)).toBe(w[0]); expect(retryDelayMs(99)).toBe(w[4]); expect(MAX_ATTEMPTS).toBe(5);
  });
  it('a 4xx means the file is gone (give up); 429, 408 and 5xx mean try again', () => {
    for (const s of [400, 401, 403, 404, 410]) expect(isPermanentFailure(s)).toBe(true);
    for (const s of [429, 408, 500, 502, 503, 200, 0, undefined]) expect(isPermanentFailure(s as never)).toBe(false);
  });
});

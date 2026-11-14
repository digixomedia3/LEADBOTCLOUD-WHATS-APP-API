import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS, checkHeaderMedia, safeFileName, sizeLabel, sniff, lintTemplate } from '../src';

const jpg = (n = 100) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const png = (n = 100) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const mp4 = (n = 100) => { const b = new Uint8Array(n); b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]); return b; };
const pdf = (n = 100) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); return b; };

describe('sniff', () => {
  it('recognises the four supported types from their bytes', () => {
    expect(sniff(jpg())).toMatchObject({ kind: 'image', mime: 'image/jpeg' }); expect(sniff(png())).toMatchObject({ kind: 'image', mime: 'image/png' });
    expect(sniff(mp4())).toMatchObject({ kind: 'video', mime: 'video/mp4' }); expect(sniff(pdf())).toMatchObject({ kind: 'document', mime: 'application/pdf' });
  });
  it('rejects everything else, including empty and tiny input', () => {
    expect(sniff(new Uint8Array([]))).toBeNull(); expect(sniff(new Uint8Array([0xff, 0xd8]))).toBeNull(); expect(sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniff(new TextEncoder().encode('GIF89a......'))).toBeNull(); expect(sniff(new TextEncoder().encode('MZ executable'))).toBeNull();
  });
});

describe('checkHeaderMedia', () => {
  it('accepts a matching file within the limit', () => {
    expect(checkHeaderMedia(jpg(1000), 'image')).toMatchObject({ ok: true, mime: 'image/jpeg', ext: 'jpg', size: 1000 });
    expect(checkHeaderMedia(pdf(5000), 'document')).toMatchObject({ ok: true, ext: 'pdf' });
  });
  it('the type comes from the bytes: a PNG renamed .jpg is still a PNG, and a wrong header type is explained', () => {
    expect(checkHeaderMedia(png(), 'image')).toMatchObject({ ok: true, mime: 'image/png', ext: 'png' });
    const r = checkHeaderMedia(pdf(), 'image'); expect(r.ok).toBe(false); if (!r.ok) { expect(r.error).toMatch(/is a PDF, but you chose a picture header/); expect(r.error).not.toMatch(/a image/); }
  });
  it('enforces the per-type size limit exactly', () => {
    expect(checkHeaderMedia(jpg(MEDIA_LIMITS.image.maxBytes), 'image').ok).toBe(true);
    const big = checkHeaderMedia(jpg(MEDIA_LIMITS.image.maxBytes + 1), 'image'); expect(big.ok).toBe(false); if (!big.ok) expect(big.error).toMatch(/5\.00 MB.*limit is 5 MB/);
    expect(checkHeaderMedia(mp4(MEDIA_LIMITS.video.maxBytes + 1), 'video').ok).toBe(false); expect(checkHeaderMedia(mp4(MEDIA_LIMITS.video.maxBytes), 'video').ok).toBe(true);
  });
  it('refuses empty and unknown files with a next step', () => {
    expect(checkHeaderMedia(new Uint8Array(), 'image')).toMatchObject({ ok: false });
    const r = checkHeaderMedia(new TextEncoder().encode('hello world, not an image'), 'image'); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/JPEG or PNG/);
  });
});

describe('sizeLabel', () => {
  it('never shows a size that looks equal to the limit when it is over it', () => {
    expect(sizeLabel(5 * 1048576 + 10)).toBe('5.00 MB'); expect(sizeLabel(17 * 1048576)).toBe('17 MB'); expect(sizeLabel(6.4 * 1048576)).toBe('6.4 MB'); expect(sizeLabel(300 * 1024)).toBe('0.3 MB'); expect(sizeLabel(20 * 1024)).toBe('20 KB'); expect(sizeLabel(10)).toBe('1 KB');
  });
});

describe('safeFileName', () => {
  it('strips paths, control characters and quotes, keeps a real extension from the bytes', () => {
    expect(safeFileName('../../etc/passwd.png', 'png')).toBe('etc passwd.png'); expect(safeFileName('My "Offer"\n.jpg', 'jpg')).toBe('My Offer.jpg');
    expect(safeFileName('', 'pdf')).toBe('header.pdf'); expect(safeFileName('   ', 'mp4')).toBe('header.mp4'); expect(safeFileName('a'.repeat(200), 'png').length).toBeLessThanOrEqual(64);
  });
});

describe('lint with a media header', () => {
  const base = { name: 'pic_offer', category: 'marketing' as const, body: 'Hi {{1}}, see our new festival range this week.', footer: 'Reply STOP to opt out', buttons: [], samples: ['Asha'] };
  it('needs the file, and cannot be combined with a text header or a one-time code', () => {
    expect(lintTemplate({ ...base, headerMedia: 'image' }).issues.some((i) => i.level === 'block' && i.field === 'header')).toBe(true);
    expect(lintTemplate({ ...base, headerMedia: 'image', hasHeaderFile: true }).blocked).toBe(false);
    expect(lintTemplate({ ...base, headerMedia: 'image', hasHeaderFile: true, headerText: 'Hi' }).blocked).toBe(true);
    expect(lintTemplate({ ...base, category: 'authentication', headerMedia: 'image', hasHeaderFile: true }).blocked).toBe(true);
  });
});

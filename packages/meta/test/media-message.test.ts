import { describe, expect, it } from 'vitest';
import { mediaMessage } from '../src/payloads';
import { GraphClient, MetaError, MetaUnknownOutcome } from '../src';

/** The media object inside the payload, whichever kind it is (the builder keys it by kind). */
const inner = (m: object, kind: string) => (m as Record<string, unknown>)[kind];
const base = { to: '+919810055501', mediaId: 'MID123', messageId: 'abc' };
describe('mediaMessage: a file typed into a chat', () => {
  it('a picture carries its id and caption, in the shape Meta documents', () => {
    expect(mediaMessage({ ...base, kind: 'image', caption: 'Your saree' })).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '+919810055501', biz_opaque_callback_data: 'msg:abc', type: 'image', image: { id: 'MID123', caption: 'Your saree' } });
  });
  it('no caption means no caption key (Meta rejects an empty one)', () => {
    expect(inner(mediaMessage({ ...base, kind: 'video', caption: '   ' }), 'video')).toEqual({ id: 'MID123' });
    expect(inner(mediaMessage({ ...base, kind: 'image' }), 'image')).toEqual({ id: 'MID123' });
  });
  it('only a document carries a file name', () => {
    expect(inner(mediaMessage({ ...base, kind: 'document', fileName: 'Quote.pdf', caption: 'q' }), 'document')).toEqual({ id: 'MID123', caption: 'q', filename: 'Quote.pdf' });
    expect(inner(mediaMessage({ ...base, kind: 'image', fileName: 'x.png' }), 'image')).toEqual({ id: 'MID123' });
  });
  it('refuses a bad id, an over-long caption, and a number without a country code', () => {
    expect(() => mediaMessage({ ...base, kind: 'image', mediaId: '../x' })).toThrow(/Media id/);
    expect(() => mediaMessage({ ...base, kind: 'image', mediaId: '' })).toThrow();
    expect(() => mediaMessage({ ...base, kind: 'image', caption: 'x'.repeat(1025) })).toThrow(/1024/);
    expect(() => mediaMessage({ ...base, kind: 'image', to: '9810055501' })).toThrow();
  });
});

describe('uploadMedia: a Meta hiccup is not a verdict on the file', () => {
  const g = (res: () => Response) => new GraphClient({ graphVersion: 'v26.0', appId: 'A', appSecret: 's', baseUrl: 'https://g.test', fetchImpl: (async () => res()) as unknown as typeof fetch });
  const file = { name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1, 2]) };
  it('a 5xx with no readable error is an unknown outcome (retried), like every other call', async () => {
    for (const st of [500, 502, 503]) await expect(g(() => new Response('', { status: st })).uploadMedia('PN', 'T', file)).rejects.toBeInstanceOf(MetaUnknownOutcome);
  });
  it('a real refusal from Meta stays a MetaError carrying its code', async () => {
    const e = await g(() => new Response(JSON.stringify({ error: { message: 'bad', code: 131053 } }), { status: 400 })).uploadMedia('PN', 'T', file).catch((x) => x);
    expect(e).toBeInstanceOf(MetaError); expect(e.code).toBe(131053);
  });
  it('a 5xx that DOES carry an error body is still a MetaError (Meta gave a verdict)', async () => {
    const e = await g(() => new Response(JSON.stringify({ error: { message: 'x', code: 1 } }), { status: 500 })).uploadMedia('PN', 'T', file).catch((x) => x);
    expect(e).toBeInstanceOf(MetaError);
  });
  it('success returns the id; success without an id is an error', async () => {
    expect(await g(() => new Response(JSON.stringify({ id: 'M1' }))).uploadMedia('PN', 'T', file)).toBe('M1');
    await expect(g(() => new Response('{}')).uploadMedia('PN', 'T', file)).rejects.toBeInstanceOf(MetaError);
  });
});

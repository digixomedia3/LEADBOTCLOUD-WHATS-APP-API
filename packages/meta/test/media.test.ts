import { describe, expect, it } from 'vitest';
import { GraphClient, MetaError, copyCodeParam, headerMediaParam } from '../src';

type Call = { url: string; init: RequestInit };
function fake(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); const r = responses.shift() ?? { body: {} }; return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); }) as unknown as typeof fetch;
  return { calls, g: new GraphClient({ graphVersion: 'v26.0', appId: 'APP1', appSecret: 's', baseUrl: 'https://g.test', fetchImpl }) };
}
const file = { name: 'offer.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) };

describe('Resumable Upload for template samples', () => {
  it('starts a session with name/length/type, then posts the raw bytes with OAuth auth and file_offset 0, and returns the handle', async () => {
    const { g, calls } = fake([{ body: { id: 'upload:SESSION123' } }, { body: { h: '4::aW-handle' } }]);
    expect(await g.uploadTemplateSample('TOKEN', file)).toBe('4::aW-handle');
    const a = new URL(calls[0]!.url); expect(a.pathname).toBe('/v26.0/APP1/uploads'); expect(a.searchParams.get('file_name')).toBe('offer.png'); expect(a.searchParams.get('file_length')).toBe('4'); expect(a.searchParams.get('file_type')).toBe('image/png');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
    expect(new URL(calls[1]!.url).pathname).toBe('/v26.0/upload:SESSION123');
    const h = calls[1]!.init.headers as Record<string, string>; expect(h.Authorization).toBe('OAuth TOKEN'); expect(h.file_offset).toBe('0'); expect(calls[1]!.init.body).toBe(file.bytes);
  });
  it('refuses unsupported types before any request, and a missing session or handle is an error', async () => {
    const a = fake([]); await expect(a.g.uploadTemplateSample('T', { ...file, mime: 'image/gif' })).rejects.toThrow(/Unsupported/); expect(a.calls).toHaveLength(0);
    await expect(fake([{ body: {} }]).g.uploadTemplateSample('T', file)).rejects.toBeInstanceOf(MetaError);
    await expect(fake([{ body: { id: 'upload:S' } }, { body: {} }]).g.uploadTemplateSample('T', file)).rejects.toThrow(/handle/);
  });
  it('surfaces Meta’s refusal with its code', async () => {
    const { g } = fake([{ body: { id: 'upload:S' } }, { status: 400, body: { error: { message: 'bad file', code: 100 } } }]);
    const e = (await g.uploadTemplateSample('T', file).catch((x: unknown) => x)) as MetaError; expect(e).toBeInstanceOf(MetaError); expect(e.code).toBe(100);
  });
});

describe('media for sending', () => {
  it('uploads multipart to the sending number and returns the id', async () => {
    const { g, calls } = fake([{ body: { id: '1037543291543636' } }]);
    expect(await g.uploadMedia('PHONE1', 'TOKEN', file)).toBe('1037543291543636');
    expect(new URL(calls[0]!.url).pathname).toBe('/v26.0/PHONE1/media');
    const form = calls[0]!.init.body as FormData; expect(form.get('messaging_product')).toBe('whatsapp'); expect(form.get('type')).toBe('image/png'); expect((form.get('file') as File).name).toBe('offer.png');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
  });
  it('builds header parameters by media kind; documents carry a file name', () => {
    expect(headerMediaParam('image', '1037543291543636')).toEqual({ type: 'header', parameters: [{ type: 'image', image: { id: '1037543291543636' } }] });
    expect(headerMediaParam('video', '1037543291543636').parameters[0]).toEqual({ type: 'video', video: { id: '1037543291543636' } });
    expect(headerMediaParam('document', '1037543291543636', 'Price list.pdf').parameters[0]).toEqual({ type: 'document', document: { id: '1037543291543636', filename: 'Price list.pdf' } });
    expect(() => headerMediaParam('image', 'not-an-id')).toThrow();
  });
  it('builds the copy-code button parameter with its position, and refuses codes Meta would reject', () => {
    expect(copyCodeParam(0, ' DIWALI25 ')).toEqual({ type: 'button', sub_type: 'copy_code', index: '0', parameters: [{ type: 'coupon_code', coupon_code: 'DIWALI25' }] });
    expect(copyCodeParam(1, 'X').index).toBe('1');
    expect(() => copyCodeParam(0, '')).toThrow(); expect(() => copyCodeParam(0, 'ABCDEFGHIJKLMNOP')).toThrow();
  });
});

import { limitedTimeOfferParam } from '../src';
describe('limited-time offer send parameter', () => {
  it('carries the end time in milliseconds under limited_time_offer', () => {
    expect(limitedTimeOfferParam(1698562800000)).toEqual({ type: 'limited_time_offer', parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: 1698562800000 } }] });
  });
  it('refuses a missing, zero, negative or fractional time', () => { for (const bad of [0, -5, NaN, 1.5, Infinity]) expect(() => limitedTimeOfferParam(bad)).toThrow(); });
});

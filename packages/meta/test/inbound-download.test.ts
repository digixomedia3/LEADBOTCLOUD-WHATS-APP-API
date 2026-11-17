import { describe, expect, it } from 'vitest';
import { GraphClient, MediaTooLarge, MetaError } from '../src';

type Call = { url: string; init: RequestInit };
/** A Graph client whose network is a script: each call returns the next response and is recorded. */
function client(make: (url: string) => Response | Promise<Response> | Error) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); const r = await make(String(url)); if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch;
  return { calls, g: new GraphClient({ graphVersion: 'v26.0', appId: 'A', appSecret: 's', baseUrl: 'https://graph.test', fetchImpl }) };
}
const bytes = (n: number, v = 7) => new Uint8Array(n).fill(v);

describe('getMediaInfo', () => {
  it('asks Graph for the media id with the workspace token', async () => {
    const { g, calls } = client(() => new Response(JSON.stringify({ id: 'M1', url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', file_size: 3 })));
    const r = await g.getMediaInfo('M1', 'TOK');
    expect(r.url).toBe('https://lookaside.fbsbx.com/x');
    expect(calls[0]!.url).toBe('https://graph.test/v26.0/M1'); expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
  });
});

describe('downloadMedia: the token only goes to Meta, and size is capped', () => {
  it('downloads from a Meta host with the token and returns bytes and type', async () => {
    const { g, calls } = client(() => new Response(bytes(5), { headers: { 'content-type': 'image/png; charset=x' } }));
    const r = await g.downloadMedia('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', 'TOK', 100);
    expect(r.bytes.byteLength).toBe(5); expect(r.mime).toBe('image/png');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
  });
  it('accepts every Meta host form and the configured test server, nothing else', async () => {
    for (const ok of ['https://lookaside.fbsbx.com/a', 'https://scontent.xx.fbcdn.net/a', 'https://mmg.whatsapp.net/a', 'https://graph.test/a']) {
      const { g } = client(() => new Response(bytes(1))); await expect(g.downloadMedia(ok, 'T', 10)).resolves.toBeTruthy();
    }
    for (const bad of ['https://evil.example.com/a', 'https://fbsbx.com.evil.com/a', 'https://notfbsbx.com/a', 'https://evil.com/?https://fbsbx.com/', 'http://lookaside.fbsbx.com/a', 'ftp://graph.test/a', 'not a url', 'https://graph.test.evil.com/a', 'https://xfacebook.com/a']) {
      const { g, calls } = client(() => new Response(bytes(1)));
      await expect(g.downloadMedia(bad, 'SECRET', 10), bad).rejects.toBeInstanceOf(MetaError);
      expect(calls.length, `${bad} must not be contacted`).toBe(0);
    }
  });
  it('never follows a redirect (which could carry the token to another host)', async () => {
    const { g, calls } = client(() => new Response(bytes(1)));
    await g.downloadMedia('https://lookaside.fbsbx.com/a', 'T', 10);
    expect(calls[0]!.init.redirect).toBe('error');
  });
  it('refuses a file whose announced size is over the cap, before reading it', async () => {
    const { g } = client(() => new Response(bytes(5), { headers: { 'content-length': '5000' } }));
    await expect(g.downloadMedia('https://lookaside.fbsbx.com/a', 'T', 100)).rejects.toBeInstanceOf(MediaTooLarge);
  });
  it('stops a server that lies about the size, as soon as it passes the cap while reading', async () => {
    const { g } = client(() => new Response(bytes(5000)));   // no content-length at all
    const e = await g.downloadMedia('https://lookaside.fbsbx.com/a', 'T', 100).catch((x) => x);
    expect(e).toBeInstanceOf(MediaTooLarge);
  });
  it('a file exactly at the cap is accepted', async () => {
    const { g } = client(() => new Response(bytes(100)));
    expect((await g.downloadMedia('https://lookaside.fbsbx.com/a', 'T', 100)).bytes.byteLength).toBe(100);
  });
  it('a 404 is a MetaError carrying the status, so the caller can give up at once', async () => {
    const { g } = client(() => new Response('gone', { status: 404 }));
    const e = await g.downloadMedia('https://lookaside.fbsbx.com/a', 'T', 100).catch((x) => x);
    expect(e).toBeInstanceOf(MetaError); expect(e.status).toBe(404);
  });
});

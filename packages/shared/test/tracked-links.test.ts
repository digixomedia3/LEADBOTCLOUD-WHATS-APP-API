import { describe, expect, it } from 'vitest';
import { checkLinkDestination, isTemporaryAppUrl, isTrackedButtonValue, LINK_CODE_RE, looksLikeBot, safeRedirectTarget, trackedButtonValue } from '../src/tracked-links';
import { generateLinkCode } from '../src/link-code';

describe('link destination', () => {
  const ok = (s: string, app?: string) => checkLinkDestination(s, app);
  it('accepts normal https addresses, with paths, queries and fragments', () => {
    for (const s of ['https://shop.example.com', 'https://shop.example.com/offers?utm_source=wa&x=1#top', 'https://www.example.co.in/a/b', '  https://shop.example.com/x  '])
      expect(ok(s).ok, s).toBe(true);
    expect((ok('https://Shop.Example.com/A') as { url: string }).url).toBe('https://shop.example.com/A');
  });
  it('refuses http, other schemes, missing scheme and junk', () => {
    for (const s of ['http://shop.example.com', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'shop.example.com', '//shop.example.com', 'https://', 'https:///x', '', '   ', 'not a url', 'https://shop example.com'])
      expect(ok(s).ok, s).toBe(false);
  });
  it('refuses embedded usernames or passwords (a classic phishing disguise)', () => {
    for (const s of ['https://user:pass@example.com', 'https://paypal.com@evil.example.com', 'https://a@b.example.com/x']) expect(ok(s).ok, s).toBe(false);
  });
  it('refuses local, numeric and internal hosts', () => {
    for (const s of ['https://localhost/x', 'https://127.0.0.1/x', 'https://192.168.1.5', 'https://10.0.0.1', 'https://[::1]/', 'https://intranet/', 'https://printer.local', 'https://db.internal', 'https://example'])
      expect(ok(s).ok, s).toBe(false);
  });
  it('refuses link shorteners and a loop back to the app itself', () => {
    for (const s of ['https://bit.ly/abc', 'https://tinyurl.com/x', 'https://t.co/x', 'https://goo.gl/x', 'https://cutt.ly/x']) expect(ok(s).ok, s).toBe(false);
    expect(ok('https://app.leadbotcloud.com/r/abc', 'https://app.leadbotcloud.com').ok).toBe(false);
    expect(ok('https://APP.leadbotcloud.com/x', 'https://app.leadbotcloud.com/').ok).toBe(false);
    expect(ok('https://shop.example.com', 'https://app.leadbotcloud.com').ok).toBe(true);
  });
  it('refuses absurdly long addresses', () => { expect(ok('https://example.com/' + 'a'.repeat(2000)).ok).toBe(false); });
  it('always explains in plain words', () => { const r = ok('http://x.com'); expect(r.ok === false && r.error.length > 10).toBe(true); });
});

describe('our tracked button', () => {
  it('is built on the app address, whatever trailing slashes it has', () => {
    expect(trackedButtonValue('https://app.example.com')).toBe('https://app.example.com/r/{{1}}');
    expect(trackedButtonValue('https://app.example.com///')).toBe('https://app.example.com/r/{{1}}');
  });
  it('is recognised exactly, and nothing near it is', () => {
    const app = 'https://app.example.com';
    expect(isTrackedButtonValue('https://app.example.com/r/{{1}}', app)).toBe(true);
    expect(isTrackedButtonValue(' https://app.example.com/r/{{1}} ', app)).toBe(true);
    for (const v of ['https://shop.example.com/{{1}}', 'https://app.example.com/{{1}}', 'https://app.example.com/r/{{2}}', 'https://app.example.com/r/abc', 'https://app.example.com/r/{{1}}/x', 'https://app.example.com.evil.com/r/{{1}}', 'http://app.example.com/r/{{1}}', '', null, undefined])
      expect(isTrackedButtonValue(v as never, app), String(v)).toBe(false);
  });
  it('knows a temporary address, which must never be baked into an approved template', () => {
    for (const u of ['http://localhost:3000', 'https://violation-rotary-loud-equilibrium.trycloudflare.com', 'https://abc.ngrok-free.app', 'http://192.168.1.4:3000', 'https://x.loca.lt', 'garbage', ''])
      expect(isTemporaryAppUrl(u), u).toBe(true);
    for (const u of ['https://app.leadbotcloud.com', 'https://panel.digixomedia.in']) expect(isTemporaryAppUrl(u), u).toBe(false);
  });
});

describe('telling robots from people', () => {
  const chrome = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';
  it('real phone browsers count', () => { expect(looksLikeBot(chrome)).toBe(false); expect(looksLikeBot(safari)).toBe(false); expect(looksLikeBot(chrome + ' WhatsApp-in-app')).toBe(false); });
  it('link previews, crawlers, scanners and scripts do not', () => {
    for (const ua of ['WhatsApp/2.23.20.0 A', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uagent.php)', 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'TelegramBot (like TwitterBot)', 'curl/8.4.0 something', 'python-requests/2.31.0', 'Go-http-client/2.0 abcdef', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 HeadlessChrome/120', 'Mozilla/5.0 (compatible; Proofpoint safelinks scanner)', 'Mozilla/5.0 Twitterbot/1.0', 'Mozilla/5.0 (compatible; UptimeRobot/2.0)', 'axios/1.6.2 node'])
      expect(looksLikeBot(ua), ua).toBe(true);
  });
  it('a missing or tiny browser string is treated as a robot, never as a person', () => { for (const ua of [null, undefined, '', '   ', 'x', 'Mozilla']) expect(looksLikeBot(ua as never), String(ua)).toBe(true); });
  it('only GET can be a person: HEAD, POST and OPTIONS are never counted', () => { for (const m of ['HEAD', 'POST', 'OPTIONS', 'head']) expect(looksLikeBot(chrome, m), m).toBe(true); expect(looksLikeBot(chrome, 'get')).toBe(false); });
});

describe('link codes', () => {
  it('are 12 letters or numbers', () => { for (let i = 0; i < 200; i++) expect(generateLinkCode()).toMatch(LINK_CODE_RE); });
  it('never repeat (and use the whole alphabet fairly)', () => {
    const seen = new Set<string>(); const freq = new Map<string, number>();
    for (let i = 0; i < 5000; i++) { const c = generateLinkCode(); seen.add(c); for (const ch of c) freq.set(ch, (freq.get(ch) ?? 0) + 1); }
    expect(seen.size).toBe(5000); expect(freq.size).toBe(62);
    const counts = [...freq.values()]; const mean = counts.reduce((a, b) => a + b, 0) / 62;
    expect(Math.min(...counts)).toBeGreaterThan(mean * 0.8); expect(Math.max(...counts)).toBeLessThan(mean * 1.2);
  });
  it('the code pattern refuses lookalikes', () => { for (const bad of ['', 'short', 'abcdefghijkl1', 'abcdefghijk', 'abcdefghij k', 'abcdefghijk-', "abcdefghijk'", 'abcdefghijk\n', '../../etc/pw']) expect(LINK_CODE_RE.test(bad), bad).toBe(false); });
});

describe('the last check before redirecting', () => {
  it('lets a normal https address through unchanged in meaning', () => { expect(safeRedirectTarget('https://shop.example.com/offer?x=1')).toBe('https://shop.example.com/offer?x=1'); });
  it('turns everything else into "not available"', () => {
    for (const bad of [null, undefined, '', 'javascript:alert(1)', 'data:text/html,x', 'http://shop.example.com', 'ftp://x.com', '//x.com', 'https://user:pw@shop.example.com', 'https://user@shop.example.com', 'https://localhost', 'https://intranet', 'not a url', 'vbscript:x'])
      expect(safeRedirectTarget(bad as never), String(bad)).toBeNull();
  });
});

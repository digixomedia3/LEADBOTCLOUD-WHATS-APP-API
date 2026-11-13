import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/lib/safe-next';

describe('safeNext (open-redirect guard)', () => {
  it('allows same-site paths', () => { expect(safeNext('/invite/abc', '/d')).toBe('/invite/abc'); expect(safeNext('/contacts?x=1', '/d')).toBe('/contacts?x=1'); });
  it('rejects external and protocol-relative URLs', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'evil.com', '/ok\r\nSet-Cookie: x=1']) expect(safeNext(bad, '/d')).toBe('/d');
  });
  it('falls back when empty', () => { expect(safeNext(null, '/d')).toBe('/d'); expect(safeNext('', '/d')).toBe('/d'); });
});

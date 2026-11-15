import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../src/app/version/route';

describe('/version', () => {
  const dirs: string[] = [];
  const withInfo = (content?: string) => {
    const d = mkdtempSync(join(tmpdir(), 'ver-')); dirs.push(d);
    if (content !== undefined) writeFileSync(join(d, 'build-info.json'), content);
    vi.spyOn(process, 'cwd').mockReturnValue(d);
  };
  afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('returns the commit and time, and can never be cached', async () => {
    withInfo(JSON.stringify({ commit: 'abc1234', deployedAt: '2026-11-15T10:00:00.000Z' }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commit: 'abc1234', deployedAt: '2026-11-15T10:00:00.000Z' });
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
  });
  it('copies out only those two fields, whatever else the file holds', async () => {
    withInfo(JSON.stringify({ commit: 'abc1234', deployedAt: '2026-11-15T10:00:00.000Z', extra: 'x', other: 'y' }));
    expect(Object.keys(await (await GET()).json()).sort()).toEqual(['commit', 'deployedAt']);
  });
  it('says "unknown" when there is no file or its content is not a commit and a time', async () => {
    for (const c of [undefined, 'not json', JSON.stringify({ commit: 'not a hash!', deployedAt: 'soon' })]) {
      withInfo(c);
      const res = await GET();
      expect(res.status).toBe(200); expect(await res.json()).toEqual({ commit: 'unknown', deployedAt: null });
    }
  });
});

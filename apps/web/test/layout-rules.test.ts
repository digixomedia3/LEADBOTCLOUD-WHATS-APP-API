import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Layout rules that have broken the phone layout before. These read the source, not the browser, so they are cheap and run with the
 * other tests. A real browser sweep at 360px is still the final check; these keep the same bug from coming back unnoticed.
 *
 * Rule 1: a scroll box around a table must be `relative`.
 *   The screen-reader-only column header (`sr-only`) is positioned absolutely. If its scroll box is not the positioned ancestor, the
 *   header is placed against the page, outside the box, and the whole page gets sideways scroll: on a phone the fixed bottom bar
 *   then stretches wider than the screen and its right-hand tabs fall off. (Contacts, 360px, 654px wide.)
 * Rule 2: a two-column grid that only splits on a big screen must name its single column, `grid-cols-[minmax(0,1fr)]`.
 *   Without it the lone column grows to its widest child instead of the screen.
 */
const ROOT = new URL('../src/', import.meta.url).pathname;
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []; });
}
const all = files(ROOT).map((p) => ({ p: p.replace(ROOT, ''), s: readFileSync(p, 'utf8') }));

describe('phone layout rules', () => {
  it('every scroll box that wraps a table is positioned (relative), so a hidden header cannot push the page wider', () => {
    const bad: string[] = [];
    for (const { p, s } of all) {
      for (const m of s.matchAll(/<div className="([^"]*\boverflow-(?:x-)?auto\b[^"]*)">\s*<table/g)) {
        if (!/\b(relative|absolute|fixed|sticky)\b/.test(m[1]!)) bad.push(`${p}: "${m[1]}"`);
      }
    }
    expect(bad, 'add `relative` to these table scroll boxes').toEqual([]);
  });

  it('the check really sees a table box (it is not passing because it finds nothing)', () => {
    const seen = all.flatMap(({ s }) => [...s.matchAll(/<div className="([^"]*\boverflow-(?:x-)?auto\b[^"]*)">\s*<table/g)]);
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });

  it('a grid that splits into a fixed rail only on a big screen names its single column', () => {
    const bad: string[] = [];
    for (const { p, s } of all) {
      for (const m of s.matchAll(/className="([^"]*\b(?:md|lg|xl):grid-cols-\[\d[^"\]]*rem_minmax\(0,1fr\)\][^"]*)"/g)) {
        const cls = m[1]!;
        if (/\bgrid\b/.test(cls) && !/(^|\s)grid-cols-(\[minmax\(0,1fr\)\]|1)(\s|$)/.test(cls)) bad.push(`${p}: "${cls}"`);
      }
    }
    expect(bad, 'add `grid-cols-[minmax(0,1fr)]` to these grids').toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { LIBRARY_GROUPS, TEMPLATE_LIBRARY, lintTemplate, uniqueTemplateName, variablesIn } from '../src';

describe('template library', () => {
  it('has unique ids and every group is used', () => {
    const ids = TEMPLATE_LIBRARY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of LIBRARY_GROUPS) expect(TEMPLATE_LIBRARY.some((t) => t.group === g)).toBe(true);
  });
  for (const t of TEMPLATE_LIBRARY) {
    it(`${t.id}: passes the submit checker with nothing blocking`, () => {
      const r = lintTemplate(t.draft);
      expect(r.issues.filter((i) => i.level === 'block'), JSON.stringify(r.issues)).toEqual([]);
    });
    it(`${t.id}: has exactly one sample per variable and no sample-looking placeholders`, () => {
      const n = new Set(variablesIn(t.draft.body)).size;
      expect(t.draft.samples).toHaveLength(n);
      for (const s of t.draft.samples) expect(s.trim()).not.toBe('');
    });
    it(`${t.id}: promotions carry an opt-out and are not marked as utility`, () => {
      const d = t.draft;
      if (d.category === 'marketing') expect(/stop/i.test(d.footer ?? '') || d.buttons.some((b) => /stop/i.test(b.text))).toBe(true);
      const promo = lintTemplate(d).issues.find((i) => i.field === 'category');
      expect(promo, 'reads like a promotion but is marked as utility').toBeUndefined();
    });
  }
  it('the lead welcome is utility and never offers anything', () => {
    const w = TEMPLATE_LIBRARY.find((t) => t.id === 'lead_welcome')!;
    expect(w.draft.category).toBe('utility');
    expect(w.when).toMatch(/agreed/);
  });
  it('picks a free name', () => {
    expect(uniqueTemplateName('a', [])).toBe('a');
    expect(uniqueTemplateName('a', ['a'])).toBe('a_2');
    expect(uniqueTemplateName('a', ['a', 'a_2', 'a_3'])).toBe('a_4');
  });
});

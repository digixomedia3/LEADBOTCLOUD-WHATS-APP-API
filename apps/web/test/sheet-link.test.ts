import { describe, expect, it } from 'vitest';
import { sheetIdFrom } from '../src/lib/sheet-link';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
describe('sheetIdFrom', () => {
  it('takes the id from a normal link, with or without extras', () => {
    expect(sheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    expect(sheetIdFrom(`  https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing `)).toBe(ID);
    expect(sheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}`)).toBe(ID);
  });
  it('accepts the bare id', () => { expect(sheetIdFrom(ID)).toBe(ID); });
  it('refuses other hosts, short ids and anything that could change the request path', () => {
    for (const bad of [`https://evil.com/spreadsheets/d/${ID}/edit`, `https://docs.google.com.evil.com/spreadsheets/d/${ID}`, 'abc', '', `${ID}/../x`, `${ID}?x=1`, `javascript:alert(1)//${ID}`, `http://docs.google.com/spreadsheets/d/${ID}`]) expect(sheetIdFrom(bad), bad).toBeNull();
  });
});

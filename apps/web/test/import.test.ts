import { describe, expect, it } from 'vitest';
import { buildPreview, detectField, parsePasted, suggestMapping, toCsv } from '../src/lib/contacts/import';

describe('detectField / suggestMapping', () => {
  it('recognises English and Hindi headers', () => {
    expect(detectField('Mobile Number')).toBe('phone');
    expect(detectField('WhatsApp')).toBe('phone');
    expect(detectField('नाम')).toBe('name');
    expect(detectField('मोबाइल')).toBe('phone');
    expect(detectField('E-mail')).toBe('email');
    expect(detectField('Plan')).toBe('tags');
    expect(detectField('Random')).toBe('ignore');
  });
  it('uses each field once and guesses the phone column from data when headers are useless', () => {
    expect(suggestMapping(['Name', 'Full name', 'Mobile'], [])).toEqual(['name', 'ignore', 'phone']);
    const m = suggestMapping(['A', 'B', 'C'], [['Asha', '98765 43210', 'x'], ['Rohit', '9123456780', 'y']]);
    expect(m).toEqual(['ignore', 'phone', 'ignore']);
  });
});

describe('buildPreview', () => {
  const map = ['name', 'phone', 'email', 'tags'] as const;
  it('normalises phones, flags bad rows with a reason and counts duplicates inside the file', () => {
    const p = buildPreview([
      ['Asha', '98765 43210', 'ASHA@Example.com', 'vip; yearly'],
      ['Rohit', '09123456780', '', ''],
      ['Bad', '12345', '', ''],
      ['Dup', '+91 98765-43210', '', ''],
      ['', '', '', ''],
    ], [...map]);
    expect(p.rows).toHaveLength(4); // blank line skipped
    expect(p.rows[0]).toMatchObject({ phone: '+919876543210', email: 'asha@example.com', tags: ['vip', 'yearly'], line: 2 });
    expect(p.rows[2]!.error).toMatch(/valid Indian mobile/);
    expect(p.rows[3]).toMatchObject({ duplicateOf: 2 });
    expect(p).toMatchObject({ valid: 2, invalid: 1, duplicates: 1 });
  });
  it('drops a malformed email instead of failing the row', () => {
    const p = buildPreview([['A', '9876543210', 'not-an-email', '']], [...map]);
    expect(p.rows[0]!.email).toBeUndefined();
    expect(p.rows[0]!.badEmail).toBe('not-an-email');
    expect(p.badEmails).toBe(1);
    expect(p.rows[0]!.error).toBeUndefined();
  });
  it('fails every row if no phone column is mapped', () => {
    const p = buildPreview([['A', 'x']], ['name', 'ignore']);
    expect(p.invalid).toBe(1);
  });
  it('trims non-breaking spaces and caps long values', () => {
    const p = buildPreview([[`\u00a0${'x'.repeat(300)}`, '9876543210', '', '']], [...map]);
    expect(p.rows[0]!.name!.length).toBe(120);
  });
});

describe('parsePasted', () => {
  it('handles numbers alone, "name, number" and "number, name"', () => {
    expect(parsePasted('9876543210\nAsha, 98765 43211\n9876543212, Rohit Singh\n\n')).toEqual([
      ['', '9876543210'], ['Asha', '98765 43211'], ['Rohit Singh', '9876543212'],
    ]);
  });
});

describe('toCsv: phone numbers', () => {
  it('keeps a real phone number readable but still escapes anything else that starts with a plus', () => {
    expect(toCsv([['+919876543210']])).toBe('+919876543210');
    for (const evil of ['+91 98765 43210', '+1+1', '+91987654321a', '+9198765432101234567', '+12345', '++919876543210', '+91\t1', '+91=1', '+919876543210\n=1+1'])
      expect(toCsv([[evil]]).replace(/^"/, '').startsWith("'"), evil).toBe(true);
    for (const f of ['=1+1', '-1', '@x', '=HYPERLINK("http://evil")']) expect(toCsv([[f]]).replace(/^"/, '').startsWith("'"), f).toBe(true);
  });
});

describe('toCsv', () => {
  it('quotes fields and neutralises spreadsheet formulas', () => {
    expect(toCsv([['a,b', 'say "hi"', '=SUM(A1)', '+91 1']])).toBe(`"a,b","say ""hi""",'=SUM(A1),'+91 1`);
  });

  it('counts a bad email only on rows that will actually be imported', () => {
    const map = ['name', 'phone', 'email', 'tags'] as const;
    const p = buildPreview([['A', '9876543210', 'bad1', ''], ['B', '9876543210', 'bad2', ''], ['C', '12345', 'bad3', ''], ['D', '9811122233', 'ok@example.com', '']], [...map]);
    expect(p.badEmails).toBe(1); // row B is a repeat and row C has a bad number, so only A counts
    expect(buildPreview([['D', '9811122233', 'ok@example.com', '']], [...map]).badEmails).toBe(0);
  });
});

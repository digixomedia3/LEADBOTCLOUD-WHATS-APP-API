import { normalizePhone } from '@lbc/shared';

/**
 * Pure CSV-import logic, kept free of I/O so it is fully unit-tested.
 * Handles Hindi and English headers, messy phone formats, in-file duplicates and Excel damage.
 */
export type Field = 'name' | 'phone' | 'email' | 'tags' | 'ignore';

const HEADER_HINTS: Record<Exclude<Field, 'ignore'>, RegExp> = {
  phone: /^(phone|mobile|mob|whatsapp|wa|number|contact|cell|tel|telephone|फोन|मोबाइल|नंबर|व्हाट्सएप)/i,
  name: /^(name|full ?name|customer|client|नाम|ग्राहक)/i,
  email: /^(e-?mail|mail|ईमेल)/i,
  tags: /^(tags?|label|labels|group|category|plan|segment|टैग)/i,
};

export function detectField(header: string): Field {
  const h = header.trim();
  for (const f of ['phone', 'email', 'name', 'tags'] as const) if (HEADER_HINTS[f].test(h)) return f;
  return 'ignore';
}

/** Suggests a mapping, using each field once; falls back to guessing the phone column from the data. */
export function suggestMapping(headers: string[], rows: string[][]): Field[] {
  const used = new Set<Field>();
  const out = headers.map((h) => {
    const f = detectField(h);
    if (f !== 'ignore' && !used.has(f)) { used.add(f); return f; }
    return 'ignore' as Field;
  });
  if (!used.has('phone')) {
    let best = -1, bestScore = 0;
    headers.forEach((_, i) => {
      if (out[i] !== 'ignore') return;
      const sample = rows.slice(0, 20);
      const score = sample.filter((r) => normalizePhone(r[i]).ok).length;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    if (best >= 0 && bestScore >= Math.max(1, Math.floor(rows.slice(0, 20).length / 2))) out[best] = 'phone';
  }
  return out;
}

export interface ParsedRow { line: number; phone?: string; name?: string; email?: string; tags: string[]; error?: string; duplicateOf?: number; badEmail?: string }
export interface ImportPreview { rows: ParsedRow[]; valid: number; invalid: number; duplicates: number; badEmails: number }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s: unknown) => String(s ?? '').replace(/\u00a0/g, ' ').trim();

export function buildPreview(rows: string[][], mapping: Field[], startLine = 2): ImportPreview {
  const seen = new Map<string, number>();
  const out: ParsedRow[] = [];
  rows.forEach((r, idx) => {
    const line = startLine + idx;
    if (r.every((c) => !clean(c))) return; // blank line
    const row: ParsedRow = { line, tags: [] };
    mapping.forEach((f, i) => {
      const v = clean(r[i]);
      if (f === 'name' && v) row.name = v.slice(0, 120);
      if (f === 'email' && v) row.email = v.toLowerCase().slice(0, 200);
      if (f === 'tags' && v) row.tags.push(...v.split(/[;,|]/).map((t) => t.trim()).filter(Boolean).map((t) => t.slice(0, 40)));
      if (f === 'phone') {
        const n = normalizePhone(v);
        if (n.ok) row.phone = n.e164; else row.error = n.reason;
      }
    });
    if (!mapping.includes('phone')) row.error = 'No column is marked as the phone number.';
    if (!row.error && row.email && !EMAIL_RE.test(row.email)) { row.badEmail = row.email; row.email = undefined; } // dropped, not fatal, but the preview says so
    if (!row.error && row.phone) {
      const first = seen.get(row.phone);
      if (first !== undefined) row.duplicateOf = first; else seen.set(row.phone, line);
    }
    out.push(row);
  });
  const invalid = out.filter((r) => r.error).length;
  const duplicates = out.filter((r) => !r.error && r.duplicateOf !== undefined).length;
  // Only count emails on rows that will actually be imported; a skipped row's email is irrelevant.
  const badEmails = out.filter((r) => !r.error && r.duplicateOf === undefined && r.badEmail !== undefined).length;
  return { rows: out, valid: out.length - invalid - duplicates, invalid, duplicates, badEmails };
}

/** Pasted numbers: one per line, optional "Name, number" or "number, name". */
export function parsePasted(text: string): string[][] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/[,;\t]/).map((p) => p.trim());
    if (parts.length === 1) return ['', parts[0]!];
    const phoneIdx = parts.findIndex((p) => normalizePhone(p).ok);
    if (phoneIdx === -1) return [parts[0]!, parts[1]!];
    const name = parts.filter((_, i) => i !== phoneIdx).join(' ');
    return [name, parts[phoneIdx]!];
  });
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: unknown) => {
    let s = String(v ?? '');
    // Block spreadsheet formula injection: a cell that starts with = + - @ (or a tab/return) is shown as plain text.
    // The one exception is a real phone number, "+" then digits only, which cannot carry a formula and must stay readable.
    if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

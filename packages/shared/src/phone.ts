/**
 * Phone normalisation (AGENTS.md rule 10): store E.164. Accepts the messy ways Indian
 * small businesses write numbers: spaces, dashes, leading 0, 91, +91, 00 91, Excel ".0".
 * Other countries are accepted only with an explicit + or 00 prefix.
 */
export type PhoneResult = { ok: true; e164: string } | { ok: false; reason: string };

export function normalizePhone(raw: unknown): PhoneResult {
  let s = String(raw ?? '').trim();
  if (!s) return { ok: false, reason: 'The phone number is empty.' };

  if (/^\d(\.\d+)?e\+?\d+$/i.test(s.replace(/\s/g, ''))) {
    return { ok: false, reason: 'Excel changed this number to a short form. Format the column as Text, then save the file again.' };
  }
  s = s.replace(/^(\d+)\.0+$/, '$1'); // 9876543210.0

  const international = s.startsWith('+') || s.startsWith('00');
  let d = s.replace(/\D/g, '');
  if (s.startsWith('00')) d = d.slice(2);

  if (international) {
    if (d.length < 8 || d.length > 15 || d.startsWith('0')) return { ok: false, reason: 'This number has the wrong length for an international number.' };
    if (d.startsWith('91') && !/^91[6-9]\d{9}$/.test(d)) return { ok: false, reason: 'Indian mobile numbers have 10 digits after +91 and start with 6, 7, 8 or 9.' };
    return { ok: true, e164: `+${d}` };
  }

  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 13 && d.startsWith('091')) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return { ok: true, e164: `+91${d}` };
  if (d.length === 12 && /^91[6-9]\d{9}$/.test(d)) return { ok: true, e164: `+${d}` };
  return { ok: false, reason: 'Not a valid Indian mobile number. Use 10 digits starting with 6, 7, 8 or 9, or add the country code with +.' };
}

/** +91 98765 43210 for display. Other countries are shown as stored. */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** +91•••••43210 for logs (AGENTS.md rule 7). */
export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 3)}•••••${e164.slice(-4)}` : '•••';
}

import type { RemoteTemplate } from './client';

/**
 * Message-format payloads for Meta (spec 7.1, 7.2). Pure functions: no network, no database.
 * Anything the spec marks [UNVERIFIED] (media headers, carousels, limited-time offers, flows) is NOT built here; those raise a clear error
 * so the panel never sends a shape we have not verified.
 */
export interface LocalTemplate {
  name: string;
  language: string;
  category: 'marketing' | 'utility' | 'authentication';
  headerText?: string | null;
  /** Picture, video or PDF header. `headerHandle` is the Resumable Upload handle Meta needs as the sample when the template is created. */
  headerMedia?: 'image' | 'video' | 'document' | null;
  headerHandle?: string | null;
  /** Limited-time offer (marketing only). Becomes the `limited_time_offer` component; the expiry time itself is given per message when sending. */
  offer?: { text: string; hasExpiration: boolean } | null;
  body: string;
  footer?: string | null;
  buttons: { type: 'quick_reply' | 'url' | 'phone' | 'copy_code'; text: string; value?: string }[];
  samples: string[];
}

export class TemplateBuildError extends Error {}

const VAR = /\{\{\s*(\d+)\s*\}\}/g;
const vars = (s: string) => [...s.matchAll(VAR)].map((m) => Number(m[1]));

export function buildTemplatePayload(t: LocalTemplate): { name: string; language: string; category: string; parameter_format: 'POSITIONAL'; components: unknown[] } {
  if (t.category === 'authentication') throw new TemplateBuildError('One-time-code formats are not supported yet.');
  const components: unknown[] = [];

  if (t.headerMedia) {
    if (t.headerText) throw new TemplateBuildError('Use either a text header or a picture, video or PDF, not both.');
    if (!t.headerHandle) throw new TemplateBuildError('The header file has not been uploaded to WhatsApp yet.');
    components.push({ type: 'HEADER', format: t.headerMedia.toUpperCase(), example: { header_handle: [t.headerHandle] } });
  } else if (t.headerText) {
    if (vars(t.headerText).length) throw new TemplateBuildError('A variable in the header is not supported yet. Move it into the message text.');
    components.push({ type: 'HEADER', format: 'TEXT', text: t.headerText });
  }

  if (t.offer) {
    if (t.category !== 'marketing') throw new TemplateBuildError('A limited-time offer must be a Promotional format.');
    if (t.footer) throw new TemplateBuildError('Limited-time offers cannot have a footer.');
    if (!t.offer.text.trim() || t.offer.text.length > 16) throw new TemplateBuildError('The offer title must be 1 to 16 characters.');
    if (t.headerMedia === 'document' || t.headerText) throw new TemplateBuildError('A limited-time offer can have a picture or video header only.');
    const btns = t.buttons;
    if (t.offer.hasExpiration && !btns.some((b) => b.type === 'copy_code')) throw new TemplateBuildError('A countdown needs a Copy code button.');
    const ci = btns.findIndex((b) => b.type === 'copy_code');
    if (ci > 0) throw new TemplateBuildError('Put the Copy code button first.');
    if (!btns.some((b) => b.type === 'url')) throw new TemplateBuildError('A limited-time offer needs a website button.');
    components.push({ type: 'limited_time_offer', limited_time_offer: { text: t.offer.text, has_expiration: t.offer.hasExpiration } });
  }

  const bodyVars = [...new Set(vars(t.body))].sort((a, b) => a - b);
  bodyVars.forEach((n, i) => { if (n !== i + 1) throw new TemplateBuildError('Variables must be numbered 1, 2, 3 in order, with none missing.'); });
  const body: Record<string, unknown> = { type: 'BODY', text: t.body };
  if (bodyVars.length) {
    const ex = t.samples.map((s) => s.trim()).filter(Boolean).slice(0, bodyVars.length);
    if (ex.length < bodyVars.length) throw new TemplateBuildError('Add a sample value for each variable.');
    body.example = { body_text: [ex] };
  }
  components.push(body);

  if (t.footer) components.push({ type: 'FOOTER', text: t.footer });

  if (t.buttons.length) {
    // Quick replies must sit together (spec 7.2). Refuse to guess a new order.
    const kinds = t.buttons.map((b) => b.type === 'quick_reply');
    const firstQr = kinds.indexOf(true), lastQr = kinds.lastIndexOf(true);
    if (firstQr !== -1 && kinds.slice(firstQr, lastQr + 1).some((x) => !x)) throw new TemplateBuildError('Put the quick-reply buttons together, before or after the other buttons.');
    const buttons = t.buttons.map((b) => {
      switch (b.type) {
        case 'quick_reply': return { type: 'QUICK_REPLY', text: b.text };
        case 'url': {
          if (!b.value) throw new TemplateBuildError('A link button needs a web address.');
          const dyn = vars(b.value).length;
          return dyn ? { type: 'URL', text: b.text, url: b.value, example: [b.value.replace(VAR, 'abc123')] } : { type: 'URL', text: b.text, url: b.value };
        }
        case 'phone': {
          const digits = (b.value ?? '').replace(/[^\d]/g, '');
          if (digits.length < 8) throw new TemplateBuildError('A call button needs a phone number with country code.');
          return { type: 'PHONE_NUMBER', text: b.text, phone_number: digits };
        }
        case 'copy_code': {
          if (!b.value) throw new TemplateBuildError('A copy-code button needs an example code.');
          return { type: 'COPY_CODE', example: b.value };
        }
      }
    });
    components.push({ type: 'BUTTONS', buttons });
  }

  return { name: t.name, language: t.language, category: t.category.toUpperCase(), parameter_format: 'POSITIONAL', components };
}

/** Meta statuses -> ours. Anything not listed returns null so the caller leaves the row alone and logs it (never guessed). */
export function mapRemoteStatus(s: string | undefined): 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled' | null {
  switch ((s ?? '').toUpperCase()) {
    case 'PENDING': case 'IN_APPEAL': return 'pending';
    case 'APPROVED': case 'REINSTATED': return 'approved';
    case 'REJECTED': return 'rejected';
    case 'PAUSED': return 'paused';
    case 'DISABLED': return 'disabled';
    default: return null;
  }
}

export const mapRemoteQuality = (q: string | undefined): 'green' | 'yellow' | 'red' | 'unknown' => {
  const v = (q ?? '').toUpperCase();
  return v === 'GREEN' ? 'green' : v === 'YELLOW' ? 'yellow' : v === 'RED' ? 'red' : 'unknown';
};

export const mapRemoteCategory = (c: string | undefined): LocalTemplate['category'] | null => {
  const v = (c ?? '').toLowerCase();
  return v === 'marketing' || v === 'utility' || v === 'authentication' ? v : null;
};

/** Reads a template made in WhatsApp Manager into our shape. Returns null for anything we can not represent faithfully (media headers, carousels, offers). */
export function parseRemoteTemplate(r: RemoteTemplate): LocalTemplate | null {
  const category = mapRemoteCategory(r.category);
  if (!category || category === 'authentication') return null;
  const comps = (r.components ?? []) as { type?: string; format?: string; text?: string; example?: { body_text?: string[][] }; buttons?: { type?: string; text?: string; url?: string; phone_number?: string; example?: unknown }[]; cards?: unknown }[];
  let headerText: string | null = null, body: string | null = null, footer: string | null = null;
  let samples: string[] = [];
  const buttons: LocalTemplate['buttons'] = [];
  for (const c of comps) {
    switch ((c.type ?? '').toUpperCase()) {
      case 'HEADER': if ((c.format ?? '').toUpperCase() !== 'TEXT') return null; headerText = c.text ?? null; break;
      case 'BODY': body = c.text ?? null; samples = c.example?.body_text?.[0] ?? []; break;
      case 'FOOTER': footer = c.text ?? null; break;
      case 'BUTTONS':
        for (const b of c.buttons ?? []) {
          const t = (b.type ?? '').toUpperCase();
          if (t === 'QUICK_REPLY') buttons.push({ type: 'quick_reply', text: b.text ?? '' });
          else if (t === 'URL') buttons.push({ type: 'url', text: b.text ?? '', value: b.url });
          else if (t === 'PHONE_NUMBER') buttons.push({ type: 'phone', text: b.text ?? '', value: b.phone_number });
          else if (t === 'COPY_CODE') buttons.push({ type: 'copy_code', text: 'Copy code', value: Array.isArray(b.example) ? String(b.example[0]) : String(b.example ?? '') });
          else return null;
        }
        break;
      default: return null; // carousel, limited-time offer, anything new: do not pretend to understand it
    }
  }
  if (!body) return null;
  return { name: r.name, language: r.language, category, headerText, body, footer, buttons, samples };
}

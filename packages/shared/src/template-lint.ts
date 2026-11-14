/**
 * Template pre-submit checker (spec B 7.5). Pure and unit-tested.
 * "block" issues stop submit; "warn" issues are shown but allowed.
 * Rules marked [BSP] in the spec are rejection patterns seen in practice, not Meta-published rules.
 */
export type Category = 'marketing' | 'utility' | 'authentication';
export interface TemplateDraft {
  name: string;
  category: Category;
  headerText?: string;
  /** A picture, video or PDF at the top. Mutually exclusive with headerText. */
  headerMedia?: 'image' | 'video' | 'document';
  /** True once a file has been chosen for the media header. */
  hasHeaderFile?: boolean;
  /** Limited-time offer: a short title above the message and, optionally, a countdown. Marketing only. */
  offer?: { text: string; hasExpiration: boolean } | null;
  body: string;
  footer?: string;
  buttons: { type: 'quick_reply' | 'url' | 'phone' | 'copy_code'; text: string; value?: string }[];
  samples: string[];
}
export interface Issue { level: 'block' | 'warn'; field: 'name' | 'header' | 'body' | 'footer' | 'buttons' | 'samples' | 'category'; message: string }
export interface LintResult { issues: Issue[]; blocked: boolean; risk: 'low' | 'medium' | 'high'; suggestedCategory?: Category }

export const LIMITS = { name: 512, header: 60, body: 1024, footer: 60, button: 25, url: 2000, buttons: 10, urlButtons: 2, offerTitle: 16, offerBody: 600 } as const;
const VAR = /\{\{\s*(\d+)\s*\}\}/g;

export function variablesIn(text: string): number[] {
  return [...text.matchAll(VAR)].map((m) => Number(m[1]));
}

const PROMO = /\b(offer|discount|sale|%\s*off|\d+\s*%|renew|renewal|expir(e|es|ing)|upgrade|limited|buy|coupon|cashback|deal|festival|diwali|holi|free|exclusive|hurry|last date|book now|join now)\b/i;
const BANNED = /\b(shared (login|account|id)|group buy|guaranteed (income|returns|profit)|double your money|crypto|bitcoin|betting|casino|lottery|adult)\b/i;

export function lintTemplate(d: TemplateDraft, existingNames: string[] = [], existingBodies: string[] = []): LintResult {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], field: Issue['field'], message: string) => issues.push({ level, field, message });

  // Name
  if (!/^[a-z0-9_]+$/.test(d.name)) add('block', 'name', 'Use only lowercase letters, numbers and underscores, for example diwali_offer_2026.');
  else if (d.name.length > LIMITS.name) add('block', 'name', 'The name is too long.');
  else if (existingNames.includes(d.name)) add('block', 'name', 'You already have a template with this name.');

  // Header
  if (d.headerMedia) {
    if (d.headerText) add('block', 'header', 'Use either a text header or a picture, video or PDF, not both.');
    if (!d.hasHeaderFile) add('block', 'header', `Choose the ${d.headerMedia === 'document' ? 'PDF' : d.headerMedia} file for the header.`);
    if (d.category === 'authentication') add('block', 'header', 'One-time-code messages cannot have a header.');
  }
  if (d.headerText) {
    if (d.headerText.length > LIMITS.header) add('block', 'header', `The header can be ${LIMITS.header} characters at most (now ${d.headerText.length}).`);
    if (variablesIn(d.headerText).length > 1) add('block', 'header', 'The header can have only one variable.');
  }

  // Body
  const body = d.body;
  if (!body.trim()) add('block', 'body', 'Write the message text.');
  if (body.length > LIMITS.body) add('block', 'body', `The message can be ${LIMITS.body} characters at most (now ${body.length}).`);
  if (body !== body.trim()) add('block', 'body', 'Remove spaces or blank lines at the start or end. Meta rejects these.');
  if (/\n\s*\n\s*\n/.test(body)) add('block', 'body', 'Remove double blank lines. Meta rejects these.');
  const vars = variablesIn(body);
  const sorted = [...new Set(vars)].sort((a, b) => a - b);
  if (sorted.some((v, i) => v !== i + 1)) add('block', 'body', 'Number variables in order: {{1}}, {{2}}, {{3}} with none missing.');
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(body)) add('block', 'body', 'The message cannot start with a variable. Add a word before {{1}}.');
  if (/\{\{\s*\d+\s*\}\}\s*$/.test(body)) add('block', 'body', 'The message cannot end with a variable. Add a word or full stop after it.');
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) add('block', 'body', 'Two variables cannot sit next to each other. Put words between them.');
  const fixed = body.replace(VAR, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
  if (sorted.length > 0 && fixed < sorted.length * 3) add('warn', 'body', 'Too many variables for the amount of text. Meta often rejects this. Add more fixed words.');

  // Samples
  const need = sorted.length;
  if (need > 0) {
    const have = d.samples.filter((s) => s.trim()).length;
    if (have < need) add('block', 'samples', `Add a sample value for each of the ${need} variable${need > 1 ? 's' : ''}. Meta needs examples to review.`);
    d.samples.forEach((s, i) => { if (/^(test|xyz|abc|sample|asdf|na|n\/a|\.+)$/i.test(s.trim())) add('warn', 'samples', `Sample ${i + 1} looks like a placeholder. Use a realistic value such as a real name or amount.`); });
  }

  // Footer
  if (d.footer && d.footer.length > LIMITS.footer) add('block', 'footer', `The footer can be ${LIMITS.footer} characters at most.`);
  if (d.footer && variablesIn(d.footer).length) add('block', 'footer', 'The footer cannot have variables.');

  // Buttons
  if (d.buttons.length > LIMITS.buttons) add('block', 'buttons', `At most ${LIMITS.buttons} buttons.`);
  if (d.buttons.filter((b) => b.type === 'url').length > LIMITS.urlButtons) add('block', 'buttons', `At most ${LIMITS.urlButtons} website buttons.`);
  if (d.buttons.filter((b) => b.type === 'phone').length > 1) add('block', 'buttons', 'Only one call button is allowed.');
  if (d.buttons.filter((b) => b.type === 'copy_code').length > 1) add('block', 'buttons', 'Only one copy-code button is allowed.');
  d.buttons.forEach((b, i) => {
    if (!b.text.trim() && b.type !== 'copy_code') add('block', 'buttons', `Button ${i + 1} needs a label.`);
    if (b.text.length > LIMITS.button) add('block', 'buttons', `Button ${i + 1}: labels can be ${LIMITS.button} characters at most.`);
    if (b.type === 'url') {
      if (!b.value || !/^https:\/\/[^\s]+$/i.test(b.value.replace(/\{\{\s*1\s*\}\}$/, 'x'))) add('block', 'buttons', `Button ${i + 1}: enter a full website address starting with https://`);
      else if (b.value.length > LIMITS.url) add('block', 'buttons', `Button ${i + 1}: the address is too long.`);
      if (/\b(bit\.ly|tinyurl|t\.co|goo\.gl|cutt\.ly)\b/i.test(b.value ?? '')) add('block', 'buttons', `Button ${i + 1}: link shorteners are not allowed. Use your own address.`);
    }
    if (b.type === 'phone' && !/^\+?\d{10,15}$/.test((b.value ?? '').replace(/[\s-]/g, ''))) add('block', 'buttons', `Button ${i + 1}: enter a valid phone number.`);
  });
  // Quick replies must be grouped together, not split by other types.
  const kinds = d.buttons.map((b) => b.type === 'quick_reply');
  const firstQr = kinds.indexOf(true), lastQr = kinds.lastIndexOf(true);
  if (firstQr !== -1 && kinds.slice(firstQr, lastQr + 1).includes(false)) add('block', 'buttons', 'Keep quick-reply buttons together, before or after the other buttons.');
  if (d.buttons.length > 3) add('warn', 'buttons', 'With more than 3 buttons, WhatsApp shows only 2 and hides the rest behind "See all options".');

  // Limited-time offer (Meta "Limited-time offer templates": marketing only, no footer, header image/video only, copy-code first, URL button required)
  if (d.offer) {
    const o = d.offer;
    if (d.category !== 'marketing') add('block', 'category', 'A limited-time offer must be a Promotional template.');
    if (!o.text.trim()) add('block', 'body', 'Write the short offer title, for example “Weekend offer!”.');
    else if (o.text.length > LIMITS.offerTitle) add('block', 'body', `The offer title can be ${LIMITS.offerTitle} characters at most (now ${o.text.length}).`);
    if (d.footer) add('block', 'footer', 'Limited-time offers cannot have a footer. Remove it.');
    if (d.headerText) add('block', 'header', 'A limited-time offer can have a picture or video header, but not a text header.');
    if (d.headerMedia === 'document') add('block', 'header', 'A limited-time offer can have a picture or video header, not a PDF.');
    if (body.length > LIMITS.offerBody) add('block', 'body', `With an offer, the message can be ${LIMITS.offerBody} characters at most (now ${body.length}).`);
    const copyAt = d.buttons.findIndex((b) => b.type === 'copy_code');
    if (o.hasExpiration && copyAt === -1) add('block', 'buttons', 'A countdown needs a Copy code button, because the countdown is for the offer code.');
    if (copyAt > 0) add('block', 'buttons', 'Put the Copy code button first.');
    if (!d.buttons.some((b) => b.type === 'url')) add('block', 'buttons', 'A limited-time offer needs a website button.');
    if (d.buttons.some((b) => b.type === 'url' && /\{\{/.test(b.value ?? ''))) add('block', 'buttons', 'For now the website address of an offer must be complete, without a {{1}} part.');
    const c = d.buttons.find((b) => b.type === 'copy_code');
    if (c && !/^[A-Za-z0-9_-]{1,15}$/.test(c.value ?? '')) add('block', 'buttons', 'Give an example offer code of 1 to 15 letters or numbers, for example WEEKEND20.');
  }

  // Category rules
  const all = [d.headerText, body, d.footer].filter(Boolean).join(' ');
  let suggested: Category | undefined;
  if (d.category === 'authentication') {
    if (/https?:\/\//i.test(all)) add('block', 'body', 'OTP messages cannot contain links.');
    if (!d.buttons.some((b) => b.type === 'copy_code')) add('block', 'buttons', 'OTP messages need a Copy code button.');
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all)) add('block', 'body', 'OTP messages cannot contain emojis.');
  } else if (d.category === 'utility' && PROMO.test(all)) {
    suggested = 'marketing';
    add('warn', 'category', 'This reads like a promotion. WhatsApp will likely treat it as Promotional, which costs about ₹0.86 instead of ₹0.12 per message. Switch the type to Promotional, or remove the offer wording.');
  }
  if (BANNED.test(all)) add('block', 'body', 'This wording is not allowed under WhatsApp’s Commerce Policy (shared accounts, guaranteed returns, betting, crypto or adult content).');
  if (d.category === 'marketing' && !d.buttons.some((b) => b.type === 'quick_reply' && /stop|unsubscribe|opt/i.test(b.text)) && !/stop/i.test(d.footer ?? '')) {
    add('warn', 'buttons', d.offer ? 'Add a “Stop promotions” button after the others. An offer cannot have a footer, so the button is how people opt out.' : 'Add a “Stop promotions” button or a footer such as “Reply STOP to opt out”. It protects your number’s quality.');
  }

  // Near duplicates
  const norm = (t: string) => t.toLowerCase().replace(VAR, '').replace(/\s+/g, ' ').trim();
  if (body.trim() && existingBodies.some((b) => norm(b) === norm(body))) add('block', 'body', 'You already have a template with this same text. Meta rejects near-duplicates.');

  const blocks = issues.filter((i) => i.level === 'block').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  return { issues, blocked: blocks > 0, risk: blocks > 0 || warns >= 3 ? 'high' : warns >= 1 ? 'medium' : 'low', suggestedCategory: suggested };
}

/** Replaces {{n}} with sample values for preview. Unfilled variables stay visible. */
export function renderPreview(text: string, values: string[]): string {
  return text.replace(VAR, (m, n) => values[Number(n) - 1]?.trim() || m);
}

/** Plain-language reason shown for a rejection (spec B 7.6). */
export function explainRejection(reason: string | null | undefined): string {
  switch ((reason ?? '').toUpperCase()) {
    case 'INVALID_FORMAT': return 'Formatting problem: check variables, blank lines and samples.';
    case 'INCORRECT_CATEGORY':
    case 'CATEGORY_NOT_AVAILABLE': return 'Meta thinks this is a different type of message, usually Promotional. Change the type or remove promotional words.';
    case 'PROMOTIONAL': return 'This reads like a promotion, so it must be a Promotional template.';
    case 'TAG_CONTENT_MISMATCH': return 'The content does not match the chosen type.';
    case 'ABUSIVE_CONTENT': return 'Meta found content that breaks its rules. Remove offensive or threatening words.';
    case 'SCAM': return 'Meta flagged this as possibly misleading. Remove exaggerated claims and unclear links.';
    default: return 'Rejected without a specific reason. Try simplifying the text, or appeal in WhatsApp Manager.';
  }
}

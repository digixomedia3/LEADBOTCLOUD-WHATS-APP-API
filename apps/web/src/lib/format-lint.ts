/**
 * Pre-submit checker for message formats (spec A4.7 / B§7.5). Pure function.
 * UI-prototype version: it will move to packages/shared with the full rule set when the
 * formats module is built. It never submits anything; it only explains risk.
 */
export type LintLevel = 'error' | 'warn' | 'info';
export interface LintIssue {
  level: LintLevel;
  text: string;
  fix: string;
}
export interface LintInput {
  name: string;
  category: 'marketing' | 'utility' | 'authentication';
  body: string;
  samples: Record<string, string>;
}
export interface LintResult {
  issues: LintIssue[];
  risk: 'low' | 'medium' | 'high';
  predictedCategory: 'marketing' | 'utility' | 'authentication';
}

const PROMO = /\b(sale|offer|discount|% ?off|buy now|limited time|deal|coupon|cashback|free)\b/i;
const RENEWAL = /\b(renew|renewal|expires?|expiry|expiring|due|overdue|pay now|payment link)\b/i;
const SHORTENERS = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|rb\.gy|cutt\.ly|is\.gd)\b/i;

export function variablesOf(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
    const v = m[1];
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function lintFormat(input: LintInput): LintResult {
  const issues: LintIssue[] = [];
  const body = input.body.trim();
  const vars = variablesOf(body);

  if (!/^[a-z0-9_]+$/.test(input.name)) {
    issues.push({
      level: 'error',
      text: 'The name can only use small letters, numbers and underscores.',
      fix: 'Try something like diwali_offer_2026.',
    });
  }
  if (body.length === 0) {
    issues.push({ level: 'error', text: 'The message is empty.', fix: 'Write what you want to tell your customers.' });
  }
  if (body.length > 1024) {
    issues.push({ level: 'error', text: 'The message is longer than 1,024 characters.', fix: 'Shorten it. Short messages get approved faster.' });
  }
  if (/^\s*\{\{/.test(body) || /\}\}\s*$/.test(body)) {
    issues.push({
      level: 'error',
      text: 'The message starts or ends with a variable like {{1}}.',
      fix: 'Add a few words before the first and after the last variable.',
    });
  }
  if (/\}\}\s*\{\{/.test(body)) {
    issues.push({ level: 'error', text: 'Two variables sit right next to each other.', fix: 'Put a word or punctuation between them.' });
  }
  const missing = vars.filter((v) => !input.samples[v]?.trim());
  if (missing.length > 0) {
    issues.push({
      level: 'error',
      text: `Add an example for ${missing.map((m) => `{{${m}}}`).join(', ')}.`,
      fix: 'WhatsApp reviewers need a sample value for every variable.',
    });
  }
  const words = body.replace(/\{\{[^}]+\}\}/g, ' ').split(/\s+/).filter(Boolean).length;
  if (vars.length > 0 && words < vars.length * 3) {
    issues.push({
      level: 'warn',
      text: 'There are many variables for very little text.',
      fix: 'Add more fixed words around the variables.',
    });
  }
  if (SHORTENERS.test(body)) {
    issues.push({ level: 'error', text: 'Short links (like bit.ly) are not allowed.', fix: 'Use your full website link.' });
  }

  let predicted = input.category;
  if (input.category === 'utility' && PROMO.test(body)) {
    predicted = 'marketing';
    issues.push({
      level: 'warn',
      text: 'This sounds promotional, so WhatsApp will likely treat it as Promotional (higher cost per message).',
      fix: 'Choose Promotional, or remove offer wording to keep it an Update.',
    });
  }
  if (input.category === 'utility' && RENEWAL.test(body)) {
    predicted = 'marketing';
    issues.push({
      level: 'warn',
      text: 'Renewal and payment-due reminders count as Promotional under WhatsApp rules.',
      fix: 'Pick Promotional. Use an Update only for "payment received" confirmations.',
    });
  }
  if (input.category === 'marketing' && issues.length === 0) {
    issues.push({ level: 'info', text: 'Looks good. Promotional messages are billed at the promotional rate.', fix: 'You can submit it for review.' });
  }

  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const risk = errors > 0 ? 'high' : warns > 0 ? 'medium' : 'low';
  return { issues, risk, predictedCategory: predicted };
}

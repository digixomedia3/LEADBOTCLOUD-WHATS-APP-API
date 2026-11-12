/** Plan limits (spec A1.4). Prices live in the database and are admin-editable; limits are code so they are testable. */
export type PlanId = 'free' | 'starter' | 'growth' | 'pro';

export const PLAN_LIMITS: Record<PlanId, { contacts: number; users: number; label: string }> = {
  free: { contacts: 500, users: 1, label: 'Free' },
  starter: { contacts: 5_000, users: 2, label: 'Starter' },
  growth: { contacts: 25_000, users: 5, label: 'Growth' },
  pro: { contacts: 100_000, users: 15, label: 'Pro' },
};

export function planLimits(plan: string) {
  return PLAN_LIMITS[(plan in PLAN_LIMITS ? plan : 'free') as PlanId];
}

/** Business categories at signup. Spec A4.2: risky ones go to review, prohibited ones are blocked. */
export type CategoryRisk = 'ok' | 'review' | 'blocked';
export const BUSINESS_CATEGORIES: { value: string; label: string; risk: CategoryRisk }[] = [
  { value: 'subscriptions', label: 'Subscriptions or digital products', risk: 'ok' },
  { value: 'coaching', label: 'Coaching or courses', risk: 'ok' },
  { value: 'education', label: 'School, tuition or education', risk: 'ok' },
  { value: 'fitness', label: 'Gym or fitness', risk: 'ok' },
  { value: 'isp', label: 'Internet or cable provider', risk: 'ok' },
  { value: 'retail', label: 'Shop or retail store', risk: 'ok' },
  { value: 'd2c', label: 'Online brand (D2C)', risk: 'ok' },
  { value: 'services', label: 'Services or agency', risk: 'ok' },
  { value: 'healthcare', label: 'Clinic or healthcare', risk: 'review' },
  { value: 'finance', label: 'Loans, insurance or investments', risk: 'review' },
  { value: 'crypto', label: 'Crypto or trading', risk: 'blocked' },
  { value: 'gambling', label: 'Gambling, betting or lottery', risk: 'blocked' },
  { value: 'adult', label: 'Adult content', risk: 'blocked' },
  { value: 'other', label: 'Other', risk: 'review' },
];

export function categoryRisk(value: string): CategoryRisk | null {
  return BUSINESS_CATEGORIES.find((c) => c.value === value)?.risk ?? null;
}

export const CONSENT_SOURCES = ['Website form', 'In shop', 'WhatsApp chat', 'Order or invoice', 'Imported list', 'Other'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
export const TERMS_VERSION = '2026-11-11';

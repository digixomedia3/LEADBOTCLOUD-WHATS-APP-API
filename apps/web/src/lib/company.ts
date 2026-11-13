import { TERMS_VERSION } from '@lbc/shared';

/**
 * Who the operator is, for the legal pages and the footer. Everything comes from the environment so nothing is invented in code
 * (spec A4.1: the legal name must match the Meta Business verification). Missing values are reported, never filled in.
 */
export interface Company {
  brand: string;
  legalName: string;
  address: string | null;
  gstin: string | null;
  supportEmail: string | null;
  supportWhatsapp: string | null;
  grievanceName: string | null;
  grievanceEmail: string | null;
  termsVersion: string;
  updated: string;
  missing: string[];
}

const v = (k: string) => (process.env[k] ?? '').trim() || null;

export function company(): Company {
  const c = {
    brand: 'LeadBotCloud',
    legalName: v('COMPANY_LEGAL_NAME') ?? 'DigiXoMedia',
    address: v('COMPANY_ADDRESS'),
    gstin: v('COMPANY_GSTIN'),
    supportEmail: v('SUPPORT_EMAIL'),
    supportWhatsapp: v('SUPPORT_WHATSAPP'),
    grievanceName: v('GRIEVANCE_OFFICER_NAME'),
    grievanceEmail: v('GRIEVANCE_OFFICER_EMAIL') ?? v('SUPPORT_EMAIL'),
    termsVersion: TERMS_VERSION,
    updated: new Date(TERMS_VERSION + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    missing: [] as string[],
  };
  if (!c.address) c.missing.push('COMPANY_ADDRESS');
  if (!c.supportEmail) c.missing.push('SUPPORT_EMAIL');
  if (!c.grievanceName) c.missing.push('GRIEVANCE_OFFICER_NAME');
  return c;
}

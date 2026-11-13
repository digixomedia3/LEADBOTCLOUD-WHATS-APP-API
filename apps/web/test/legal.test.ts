import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { BUSINESS_CATEGORIES, PLAN_LIMITS } from '@lbc/shared';
import { company } from '../src/lib/company';
import { acceptableUse, dataDeletion, messagingPolicy, privacy, refunds, terms } from '../src/components/legal/content';

const KEYS = ['COMPANY_LEGAL_NAME', 'COMPANY_ADDRESS', 'COMPANY_GSTIN', 'SUPPORT_EMAIL', 'SUPPORT_WHATSAPP', 'GRIEVANCE_OFFICER_NAME', 'GRIEVANCE_OFFICER_EMAIL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.unstubAllEnvs(); });

const html = (p: { title: string; intro: React.ReactNode; sections: { id: string; title: string; body: React.ReactNode }[] }) =>
  renderToStaticMarkup(createElement('div', null, p.intro, ...p.sections.map((s) => createElement('section', { key: s.id, id: s.id }, s.title, s.body))));
const ALL = { terms, privacy, acceptableUse, messagingPolicy, refunds, dataDeletion };

describe('company details come from the environment and are never invented', () => {
  it('reports exactly which required details are missing', () => {
    for (const k of KEYS) delete process.env[k];
    const c = company();
    expect(c.legalName).toBe('DigiXoMedia');
    expect(c.address).toBeNull(); expect(c.supportEmail).toBeNull();
    expect(c.missing).toEqual(['COMPANY_ADDRESS', 'SUPPORT_EMAIL', 'GRIEVANCE_OFFICER_NAME']);
  });
  it('is complete once the details are set, and the grievance mail falls back to support', () => {
    process.env.COMPANY_ADDRESS = 'Test Address 1'; process.env.SUPPORT_EMAIL = 'help@example.org'; process.env.GRIEVANCE_OFFICER_NAME = 'A Person';
    const c = company();
    expect(c.missing).toEqual([]); expect(c.grievanceEmail).toBe('help@example.org');
  });
  it('trims blanks, so an empty variable counts as missing', () => {
    process.env.COMPANY_ADDRESS = '   ';
    expect(company().missing).toContain('COMPANY_ADDRESS');
  });
});

describe('legal pages', () => {
  it('every page has a title, an intro and unique section ids', () => {
    for (const [name, fn] of Object.entries(ALL)) {
      const p = fn();
      expect(p.title.length, name).toBeGreaterThan(3);
      const ids = p.sections.map((s) => s.id);
      expect(new Set(ids).size, name).toBe(ids.length);
      expect(p.sections.length, name).toBeGreaterThanOrEqual(4);
    }
  });
  it('shows the operator name and contact details from the environment, never a hard-coded address', () => {
    process.env.COMPANY_LEGAL_NAME = 'Example Pvt Ltd'; process.env.COMPANY_ADDRESS = 'Plot 9, Example Road'; process.env.SUPPORT_EMAIL = 'help@example.org'; process.env.GRIEVANCE_OFFICER_NAME = 'Grievance Person';
    expect(html(terms())).toContain('Example Pvt Ltd'); expect(html(terms())).toContain('help@example.org'); expect(html(terms())).toContain('Plot 9, Example Road');
    expect(html(privacy())).toContain('Grievance Person');
    expect(html(refunds())).toContain('Example Pvt Ltd');
  });
  it('does not invent contact details when none are set', () => {
    for (const k of KEYS) delete process.env[k];
    for (const [name, fn] of Object.entries(ALL)) expect(html(fn()), name).not.toMatch(/@[a-z0-9-]+\.(com|in|org)/i);
  });
  it('legal text matches how the product behaves', () => {
    for (const k of KEYS) delete process.env[k];
    const t = html(terms()), p = html(privacy()), m = html(messagingPolicy()), r = html(refunds());
    expect(t).toMatch(/billed <strong>by Meta directly to you<\/strong>/); // Meta fees are paid to Meta, not us
    expect(t).toContain('18% GST');
    expect(p).toContain('encrypted');                                    // tokens are AES-256-GCM encrypted
    expect(p).toContain('90 days');                                      // deletion window matches the spec
    expect(m).toContain('24 hours');                                     // reply window
    expect(m).toMatch(/STOP/); expect(m).toMatch(/START/);              // opt-out and opt-in keywords the worker honours
    expect(r).toMatch(/not<\/strong> cover WhatsApp message charges/);
  });
  it('the Acceptable Use Policy bans every category the signup screen blocks', () => {
    const a = html(acceptableUse()).toLowerCase();
    const blocked = BUSINESS_CATEGORIES.filter((c) => c.risk === 'blocked').map((c) => c.value);
    expect(blocked.length).toBeGreaterThan(0);
    for (const v of blocked) expect(a, v).toContain(v === 'crypto' ? 'crypto' : v === 'gambling' ? 'gambling' : 'adult');
    expect(a).toMatch(/shared and resold accounts|resold|group buys/);
  });
  it('every page the signup form and footer link to exists', () => {
    const slugs = ['terms', 'privacy', 'acceptable-use', 'messaging-policy', 'refunds', 'data-deletion'];
    expect(Object.keys(ALL)).toHaveLength(slugs.length);
  });
  it('the plans the terms and refund policy talk about exist', () => { expect(Object.keys(PLAN_LIMITS)).toContain('free'); });
});

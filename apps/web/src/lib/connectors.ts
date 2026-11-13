import { GoogleClient, MetaLeadsClient, ShopifyClient } from '@lbc/connectors';

export const PROVIDERS = ['meta_lead_ads', 'shopify', 'google_sheets'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);

const e = (k: string) => (process.env[k] ?? '').trim();

/** The public address of THIS web app. Providers send the browser back here, so it must match what is registered with them. */
export const appBase = () => (e('APP_URL') || 'http://localhost:3000').replace(/\/+$/, '');
export const redirectUri = (p: Provider) => `${appBase()}/api/connect/${p}/callback`;
export const workerBase = () => e('WORKER_PUBLIC_URL').replace(/\/+$/, '');
export const tokenKey = () => e('TOKEN_ENCRYPTION_KEY');

export function meta() {
  if (!e('META_APP_ID') || !e('META_APP_SECRET')) return null;
  return new MetaLeadsClient({ appId: e('META_APP_ID'), appSecret: e('META_APP_SECRET'), graphVersion: e('META_GRAPH_VERSION') || 'v26.0', baseUrl: e('META_GRAPH_BASE_URL') || undefined });
}
export function shopify() {
  if (!e('SHOPIFY_CLIENT_ID') || !e('SHOPIFY_CLIENT_SECRET')) return null;
  return new ShopifyClient({
    clientId: e('SHOPIFY_CLIENT_ID'), clientSecret: e('SHOPIFY_CLIENT_SECRET'), apiVersion: e('SHOPIFY_API_VERSION') || '2026-10',
    // Test hooks only: point at a local fake instead of the merchant's *.myshopify.com. Never set in production.
    scheme: e('SHOPIFY_TEST_HOST') ? 'http' : undefined, hostOverride: e('SHOPIFY_TEST_HOST') || undefined,
  });
}
export function google() {
  if (!e('GOOGLE_CLIENT_ID') || !e('GOOGLE_CLIENT_SECRET')) return null;
  return new GoogleClient({ clientId: e('GOOGLE_CLIENT_ID'), clientSecret: e('GOOGLE_CLIENT_SECRET'), authBase: e('GOOGLE_AUTH_BASE') || undefined, tokenUrl: e('GOOGLE_TOKEN_URL') || undefined, sheetsBase: e('GOOGLE_SHEETS_BASE') || undefined });
}

/** What can be connected on this installation right now. A provider is only offered when everything it needs is set. */
export function availability(): Record<Provider, { ready: boolean; why: string | null }> {
  const base = !!tokenKey() && !!workerBase();
  const need = (ok: boolean, what: string) => (ok ? { ready: true, why: null } : { ready: false, why: what });
  return {
    meta_lead_ads: need(!!meta() && base, 'Facebook app credentials are not set on this installation yet.'),
    shopify: need(!!shopify() && base, 'Shopify app credentials are not set on this installation yet.'),
    google_sheets: need(!!google() && !!tokenKey(), 'Google app credentials are not set on this installation yet.'),
  };
}

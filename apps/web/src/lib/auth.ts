import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { createDb, user, session, account, verification } from '@lbc/db';

/**
 * Better Auth uses its own connection. Its tables (user, session, account, verification) are GLOBAL and hold no
 * tenant data. It connects as the `app` role; those four tables are not under RLS, so this is safe, and the app role
 * still cannot read any tenant table without a tenant context.
 */
declare global {
  var __lbcAuthDb: ReturnType<typeof createDb> | undefined;
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const conn = (globalThis.__lbcAuthDb ??= createDb(url, { max: 5 }));

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(conn.db, { provider: 'pg', schema: { user, session, account, verification } }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  // Google is wired but off until GOOGLE_AUTH_ENABLED=true and credentials exist (step 1 amendment).
  socialProviders:
    process.env.GOOGLE_AUTH_ENABLED === 'true' && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
      : undefined,
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 8 }, '/sign-up/email': { window: 60, max: 5 } } },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  trustedOrigins: [process.env.APP_URL ?? 'http://localhost:3000', ...(process.env.TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)],
  plugins: [nextCookies()], // keep last
});

export type Session = typeof auth.$Infer.Session;

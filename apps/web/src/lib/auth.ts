import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins';
import { createAuthMiddleware } from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth';
import { createDb, user, session, account, verification, twoFactor } from '@lbc/db';
import { layout, sendMail } from '@/lib/mail';

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

/**
 * The two-factor plugin lets a client ask to "trust this device" for 30 days, after which the code is skipped. There is no setting to turn that off, and our screen never
 * offers it, but anyone calling the API directly could set it. So the flag is removed from every code check before the plugin sees it: the code is asked on every sign-in,
 * always. A stolen password plus a laptop someone once borrowed must not be enough for people (staff especially) who can read other people's data.
 */
const neverTrustDevice: BetterAuthPlugin = {
  id: 'never-trust-device',
  hooks: {
    before: [{
      matcher: (ctx: { path?: string }) => typeof ctx.path === 'string' && /^\/two-factor\/verify-(totp|backup-code|otp)$/.test(ctx.path),
      handler: createAuthMiddleware(async (ctx) => {
        // The result is merged over the request, so a missing key would be put back. Overwrite it with false instead.
        if (ctx.body && typeof ctx.body === 'object' && (ctx.body as Record<string, unknown>).trustDevice) return { context: { body: { trustDevice: false } } };
      }),
    }],
  },
};

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(conn.db, { provider: 'pg', schema: { user, session, account, verification, twoFactor } }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    // Password reset: the link is valid for one hour and signs the user out everywhere once the password changes.
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user: u, url }) => {
      // Not awaited on purpose: response time must not reveal whether the address has an account.
      const m = layout({ heading: 'Reset your password', lines: ['We got a request to reset the password for your LeadBotCloud account.', 'This link works for 1 hour and only once. If you did not ask for it, ignore this email. Your password stays the same.'], button: { label: 'Choose a new password', url }, footer: 'Sent because a password reset was requested for this email address.' });
      void sendMail({ to: u.email, subject: 'Reset your LeadBotCloud password', text: m.text, html: m.html });
    },
    onPasswordReset: async ({ user: u }) => {
      const m = layout({ heading: 'Your password was changed', lines: ['The password for your LeadBotCloud account was just changed, and you were signed out on all devices.', 'If this was not you, reset your password again straight away.'] });
      void sendMail({ to: u.email, subject: 'Your LeadBotCloud password was changed', text: m.text, html: m.html });
    },
  },
  // Google is wired but off until GOOGLE_AUTH_ENABLED=true and credentials exist (step 1 amendment).
  socialProviders:
    process.env.GOOGLE_AUTH_ENABLED === 'true' && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
      : undefined,
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 8 }, '/two-factor/verify-totp': { window: 60, max: 5 }, '/two-factor/verify-backup-code': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 5 }, '/request-password-reset': { window: 300, max: 5 }, '/reset-password': { window: 300, max: 10 } } },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  trustedOrigins: [process.env.APP_URL ?? 'http://localhost:3000', ...(process.env.TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)],
  plugins: [
    // Authenticator-app codes with one-time backup codes. The plugin encrypts the secret and the backup codes with BETTER_AUTH_SECRET before storing them.
    // Wrong codes lock the account for 15 minutes after 10 tries, on top of the per-address rate limit below. Email or SMS codes are not offered: they would
    // make the second step only as strong as an email inbox, and email is not set up yet anyway.
    twoFactorPlugin({ issuer: 'LeadBotCloud', totpOptions: { digits: 6, period: 30 }, backupCodeOptions: { amount: 10, length: 10 }, accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 } }),
    neverTrustDevice,
    nextCookies(), // keep last
  ],
});

export type Session = typeof auth.$Infer.Session;

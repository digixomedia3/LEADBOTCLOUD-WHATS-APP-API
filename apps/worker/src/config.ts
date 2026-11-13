import { z } from 'zod';
import { parseEnv } from '@lbc/shared';

/** Worker configuration. Validated at startup; the error lists names and reasons only, never values. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL_WORKER: z.string().min(1),
  REDIS_URL: z.string().min(1),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v26.0'),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  /** Test hook: point Graph calls at a local fake. Never set in production. */
  META_GRAPH_BASE_URL: z.string().url().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Shared with the web app to sign calls for work the web database role may not do (creating leads). */
  INTERNAL_API_SECRET: z.string().optional(),
  /** Where Fastify may trust X-Forwarded-For from (reverse proxy / tunnel), so per-IP limits see the real client. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Shopify app (client id/secret) used to verify webhooks and, in the web app, to connect stores. */
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Test hooks: point Google at a local fake. Never set in production. */
  GOOGLE_TOKEN_URL: z.string().url().optional(),
  GOOGLE_SHEETS_BASE: z.string().url().optional(),
  /** How often connected Google Sheets are read. Short values are for tests only. */
  SHEETS_SYNC_MS: z.coerce.number().int().min(2000).default(120_000),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
});
export type WorkerConfig = z.infer<typeof schema>;
export const loadConfig = (src: NodeJS.ProcessEnv = process.env): WorkerConfig => parseEnv(schema, src);

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
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
});
export type WorkerConfig = z.infer<typeof schema>;
export const loadConfig = (src: NodeJS.ProcessEnv = process.env): WorkerConfig => parseEnv(schema, src);

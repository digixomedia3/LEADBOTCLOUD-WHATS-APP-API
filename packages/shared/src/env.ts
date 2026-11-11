import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  WORKER_URL: z.string().url().default('http://localhost:4000'),
  REDIS_URL: z.string().min(1),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v26.0'),
  MAIL_TRANSPORT: z.enum(['console']).default('console'),
});

export const webEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url(),
  GOOGLE_AUTH_ENABLED: bool,
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  INTERNAL_API_SECRET: z.string().min(32, 'must be at least 32 characters'),
});

export const workerEnvSchema = baseEnvSchema.extend({
  DATABASE_URL_WORKER: z.string().min(1),
  INTERNAL_API_SECRET: z.string().min(32, 'must be at least 32 characters'),
  PORT: z.coerce.number().int().default(4000),
});

/**
 * Validates env at startup. The error lists variable names and reasons only,
 * never the values, so secrets cannot leak into logs.
 */
export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const r = schema.safeParse(source);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return r.data;
}

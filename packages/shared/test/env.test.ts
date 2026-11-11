import { describe, expect, it } from 'vitest';
import { parseEnv, webEnvSchema } from '../src/env';

const good = {
  APP_URL: 'http://localhost:3000',
  REDIS_URL: 'redis://localhost:6380',
  DATABASE_URL: 'postgres://x',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  INTERNAL_API_SECRET: 'b'.repeat(32),
} as unknown as NodeJS.ProcessEnv;

describe('env validation', () => {
  it('accepts a valid web env and applies defaults', () => {
    const e = parseEnv(webEnvSchema, good);
    expect(e.META_GRAPH_VERSION).toBe('v26.0');
    expect(e.GOOGLE_AUTH_ENABLED).toBe(false);
  });

  it('fails fast naming the variable but never printing its value', () => {
    const bad = { ...good, BETTER_AUTH_SECRET: 'tooshort-SECRETVALUE' } as NodeJS.ProcessEnv;
    expect(() => parseEnv(webEnvSchema, bad)).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv(webEnvSchema, bad)).not.toThrow(/SECRETVALUE/);
  });

  it('rejects a malformed Graph version', () => {
    const bad = { ...good, META_GRAPH_VERSION: '26' } as NodeJS.ProcessEnv;
    expect(() => parseEnv(webEnvSchema, bad)).toThrow(/META_GRAPH_VERSION/);
  });
});

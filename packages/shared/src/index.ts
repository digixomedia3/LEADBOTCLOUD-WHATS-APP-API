export * from './env';
export * from './phone';
export * from './plans';
import en from './i18n/en.json';

export const i18n = { en } as const;
export type Locale = keyof typeof i18n;
export * from './template-lint';
export * from './errors';
export * from './cost';

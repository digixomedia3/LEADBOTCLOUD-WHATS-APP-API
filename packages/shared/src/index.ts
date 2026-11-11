export * from './env';
import en from './i18n/en.json';

export const i18n = { en } as const;
export type Locale = keyof typeof i18n;

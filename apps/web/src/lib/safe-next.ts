/** Only same-site, absolute-path redirects are honoured. Blocks open redirects such as //evil.com or https://evil.com. */
export function safeNext(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || /[\r\n]/.test(value)) return fallback;
  return value;
}

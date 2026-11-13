/** Accepts the whole Google Sheets link or just the id. Anything else is refused, so nothing odd is ever put into an API address. */
export function sheetIdFrom(input: string): string | null {
  const s = input.trim();
  const m = s.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,100})(?:[/?#]|$)/) ?? s.match(/^([a-zA-Z0-9_-]{20,100})$/);
  return m?.[1] ?? null;
}

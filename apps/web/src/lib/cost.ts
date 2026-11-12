/**
 * Cost maths for the campaign preview and the home-page calculator (one source, tested).
 * Money is integer paise. Rates are per message in hundredths of a paisa so ₹0.8631 is exact.
 * Rates are [BSP]-sourced (spec Part B): verify against Meta's own India rate card before launch.
 */
export const RATE_PAISE_X100 = { marketing: 8631, utility: 1150, authentication: 1150 } as const;
export const GST_PCT = 18;

export function inr(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function estimateCost(messages: number, category: string) {
  const rate = RATE_PAISE_X100[(category in RATE_PAISE_X100 ? category : 'marketing') as keyof typeof RATE_PAISE_X100];
  const basePaise = Math.round((messages * rate) / 100);
  const gstPaise = Math.round((basePaise * GST_PCT) / 100);
  const totalPaise = basePaise + gstPaise;
  return { messages, ratePerMessage: rate / 10000, basePaise, gstPaise, totalPaise, baseLabel: inr(basePaise), gstLabel: inr(gstPaise), totalLabel: inr(totalPaise) };
}

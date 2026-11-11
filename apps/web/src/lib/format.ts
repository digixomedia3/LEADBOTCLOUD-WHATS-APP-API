/** Money is integer paise everywhere (AGENTS.md rule 9). Display in INR with Indian digit grouping. */
const inrFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const inrFmt2 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function inr(paise: number, opts: { decimals?: boolean } = {}): string {
  const rupees = paise / 100;
  return (opts.decimals ? inrFmt2 : inrFmt).format(rupees);
}

export function num(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

export function pct(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

/** Fills one template variable for one person. One definition, so a campaign, a journey and a test message can never fill a placeholder differently. */
export function resolveVar(spec: string, c: { name: string | null; phone: string }): string {
  if (spec === '@name') return (c.name ?? '').trim().split(/\s+/)[0] || 'there';
  if (spec === '@fullname') return (c.name ?? '').trim() || 'there';
  if (spec === '@phone') return c.phone;
  return spec;
}

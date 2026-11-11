/**
 * Number status shown in the top bar of every screen, like AiSensy's
 * "Quality Rating / Template Messaging Tier / Remaining Quota / WABA Status".
 * DEMO values for the prototype; real values come from Meta via packages/meta.
 */
export const numberStatus = {
  displayName: 'DiGiXO Store',
  phone: '+91 00000 11100',
  quality: 'high' as 'high' | 'medium' | 'low',
  tier: 'Tier 1',
  tierLimit: '1K / 24 hours',
  remainingQuota: 580,
  wabaLive: true,
};

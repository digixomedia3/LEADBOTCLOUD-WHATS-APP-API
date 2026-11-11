/**
 * Cost estimate for a bulk send. Rates are stored as paise x 100 (spec B§3 `rate_paise_x100`).
 * Placeholder India rates from Part B [BSP]: marketing 0.8631, utility/auth 0.1150 INR ex-GST.
 * The real table is super-admin-editable and has effective dates; every figure is an ESTIMATE.
 */
export type Category = 'marketing' | 'utility' | 'authentication';

export const RATE_PAISE_X100: Record<Category, number> = {
  marketing: 8631,
  utility: 1150,
  authentication: 1150,
};

export const GST_PERCENT = 18;

export interface CostEstimate {
  count: number;
  category: Category;
  ratePaise: number;
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
}

export function estimateCost(count: number, category: Category): CostEstimate {
  const safe = Math.max(0, Math.floor(count));
  const subtotalPaise = Math.round((safe * RATE_PAISE_X100[category]) / 100);
  const gstPaise = Math.round((subtotalPaise * GST_PERCENT) / 100);
  return {
    count: safe,
    category,
    ratePaise: RATE_PAISE_X100[category] / 100,
    subtotalPaise,
    gstPaise,
    totalPaise: subtotalPaise + gstPaise,
  };
}

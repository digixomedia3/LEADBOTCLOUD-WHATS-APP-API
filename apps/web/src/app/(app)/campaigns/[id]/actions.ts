'use server';

import { campaignRecipientsFor, RESULT_FILTERS, type ResultFilter } from '@/lib/core/campaign-report';
import { requireCtx } from '@/lib/session';

export async function loadRecipients(id: string, filter: ResultFilter, page: number) {
  const ctx = await requireCtx();
  if (!(RESULT_FILTERS as readonly string[]).includes(filter)) return null;
  const r = await campaignRecipientsFor(ctx, id, filter, page);
  return r.ok ? r.data : null;
}

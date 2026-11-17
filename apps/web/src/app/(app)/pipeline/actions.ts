'use server';

import { sql } from 'drizzle-orm';
import { LEAD_STATUSES } from '@lbc/shared';
import type { Band } from '@lbc/shared/lead-score';
import { db, requireCtx } from '@/lib/session';
import { scoreLeadsIn } from '@/lib/core/lead-score';

export interface Card { id: string; name: string | null; phone: string; status: string; source: string | null; owner: string | null; valueRupees: number; createdAt: string; score: number; band: Band }
export async function loadPipeline(onlyMine = false): Promise<{ cards: Card[]; truncated: boolean; me: string }> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const r = (await tx.execute(sql`select l.id, l.status, l.value_paise, l.created_at, c.name, c.phone_e164, s.name as source, u.name as owner
      from leads l join contacts c on c.id = l.contact_id left join lead_sources s on s.id = l.source_id left join "user" u on u.id = l.owner_user_id
      where l.status = any(${sql.raw(`ARRAY[${LEAD_STATUSES.map((s) => `'${s}'`).join(',')}]::text[]`)}) and (${onlyMine} = false or l.owner_user_id = ${ctx.user.id})
        and l.status <> 'junk' order by l.updated_at desc limit 301`)) as unknown as { id: string; status: string; value_paise: string; created_at: string; name: string | null; phone_e164: string; source: string | null; owner: string | null }[];
    const sc = await scoreLeadsIn(tx, ctx.tenantId, r.slice(0, 300).map((x) => x.id));
    return {
      me: ctx.user.id, truncated: r.length > 300,
      cards: r.slice(0, 300).map((x) => ({ id: x.id, name: x.name, phone: x.phone_e164, status: x.status, source: x.source, owner: x.owner, valueRupees: Number(x.value_paise) / 100, createdAt: new Date(x.created_at).toISOString(), score: sc.get(x.id)?.score ?? 0, band: sc.get(x.id)?.band ?? 'cold' })),
    };
  });
}

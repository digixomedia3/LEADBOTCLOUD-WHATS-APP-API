import type { Metadata } from 'next';
import { RenewalsView } from '@/components/renewals/renewals-view';
import { requireCtx, db } from '@/lib/session';
import { formatPhone } from '@lbc/shared';
import { contacts } from '@lbc/db';
import { asc } from 'drizzle-orm';
import { listRenewals } from './actions';

export const metadata: Metadata = { title: 'Renewals' };
export const dynamic = 'force-dynamic';

export default async function RenewalsPage() {
  const ctx = await requireCtx();
  const list = await db(ctx, (tx) => tx.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts).orderBy(asc(contacts.name)).limit(2000));
  return <RenewalsView initial={await listRenewals()} contacts={list.map((c) => ({ id: c.id, label: `${c.name ?? 'No name'} · ${formatPhone(c.phone)}` }))} canEdit={ctx.role === 'owner' || ctx.role === 'admin'} />;
}

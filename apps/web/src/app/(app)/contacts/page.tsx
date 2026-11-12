import type { Metadata } from 'next';
import { ContactsView } from '@/components/contacts/contacts-view';
import { contactSummary, listContacts, listGroups } from './actions';
import { requireCtx } from '@/lib/session';

export const metadata: Metadata = { title: 'Contacts' };
export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const ctx = await requireCtx();
  const [initial, summary, groups] = await Promise.all([listContacts({ page: 1 }), contactSummary(), listGroups()]);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';
  const canWrite = canManage || ctx.role === 'agent';
  return <ContactsView initial={initial} summary={summary} groups={groups} canManage={canManage} canWrite={canWrite} />;
}

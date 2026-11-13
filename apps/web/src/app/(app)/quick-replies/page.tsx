import type { Metadata } from 'next';
import { QuickRepliesView } from '@/components/quick-replies/quick-replies-view';
import { requireCtx } from '@/lib/session';
import { listQuickReplies } from '../chats/actions';

export const metadata: Metadata = { title: 'Quick replies' };
export const dynamic = 'force-dynamic';

export default async function QuickRepliesPage() {
  const ctx = await requireCtx();
  return <QuickRepliesView initial={await listQuickReplies()} canEdit={ctx.role === 'owner' || ctx.role === 'admin'} />;
}

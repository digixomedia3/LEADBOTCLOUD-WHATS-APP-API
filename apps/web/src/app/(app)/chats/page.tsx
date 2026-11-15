import type { Metadata } from 'next';
import { ChatsView } from '@/components/chats/chats-view';
import { isLive } from '@/lib/core/campaigns';
import { requireCtx } from '@/lib/session';
import { listConversations, listQuickReplies, listTeam } from './actions';

export const metadata: Metadata = { title: 'Chats' };
export const dynamic = 'force-dynamic';

export default async function ChatsPage() {
  const ctx = await requireCtx();
  const [initial, team, quick, live] = await Promise.all([listConversations('open'), listTeam(), listQuickReplies(), isLive(ctx)]);
  return <ChatsView initial={initial} team={team} quick={quick} me={ctx.user.id} canReply={ctx.role !== 'viewer'} live={live} />;
}

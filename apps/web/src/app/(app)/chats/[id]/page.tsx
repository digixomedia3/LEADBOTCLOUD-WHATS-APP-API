import { notFound } from 'next/navigation';
import { chats } from '@/lib/demo-data';
import { Conversation } from '@/components/chats/conversation';

export function generateStaticParams() {
  return chats.map((c) => ({ id: c.id }));
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = chats.find((c) => c.id === id);
  if (!chat) notFound();
  return <Conversation chat={chat} />;
}

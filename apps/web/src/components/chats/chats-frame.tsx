'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { ChatList } from '@/components/chats/chat-list';
import { cn } from '@/lib/utils';

/** Mobile: list OR conversation. Desktop (md+): list on the left, conversation + customer panel on the right. */
export function ChatsFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const inConversation = path !== '/chats';
  return (
    <div className="md:grid md:h-[calc(100dvh-4rem)] md:grid-cols-[20rem_minmax(0,1fr)] md:gap-4">
      <section aria-label="Chat list" className={cn('min-w-0 md:block md:overflow-hidden', inConversation && 'hidden')}>
        <h1 className="mb-3 text-2xl font-bold md:hidden">Chats</h1>
        <ChatList />
      </section>
      <section className={cn('min-h-0 min-w-0', !inConversation && 'hidden md:block')}>
        {inConversation ? (
          children
        ) : (
          <div className="hidden h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-center md:flex">
            <MessageCircle className="size-8 text-muted-foreground" />
            <p className="font-semibold">Pick a chat to start</p>
            <p className="max-w-xs text-sm text-muted-foreground">Choose a customer on the left to read and reply.</p>
            <Link href="/chats/c1" className="text-sm font-semibold text-primary">Open the first chat</Link>
          </div>
        )}
      </section>
    </div>
  );
}

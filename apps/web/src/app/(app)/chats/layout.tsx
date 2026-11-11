import { ChatsFrame } from '@/components/chats/chats-frame';

export default function ChatsLayout({ children }: { children: React.ReactNode }) {
  return <ChatsFrame>{children}</ChatsFrame>;
}

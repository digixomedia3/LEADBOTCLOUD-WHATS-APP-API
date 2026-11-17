'use client';

import { FileText, Loader2, TriangleAlert } from 'lucide-react';
import type { MediaRef } from '@/app/(app)/chats/actions';

const WORD: Record<string, string> = { image: 'photo', audio: 'voice message', video: 'video', document: 'document', sticker: 'sticker' };
const size = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** What a customer's file looks like in the chat. A file that cannot be shown still says so, and the message text under it always stays. */
export function MediaBubble({ media: m }: { media: MediaRef }) {
  const url = `${m.sent ? '/api/chat-attachments' : '/api/inbound-media'}/${m.id}`;
  if (m.state === 'pending') return <p className="flex items-center gap-2 py-1 text-sm opacity-80" role="status"><Loader2 className="size-4 animate-spin" />Loading the {WORD[m.kind] ?? 'file'}…</p>;
  if (m.state === 'expired') return <p className="flex items-start gap-2 py-1 text-sm opacity-80"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />This {WORD[m.kind] ?? 'file'} is old and was removed to save space.</p>;
  if (m.state === 'too_large') return <p className="flex items-start gap-2 py-1 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />This {WORD[m.kind] ?? 'file'} is over 16 MB, so it was not saved. Ask the customer to send a smaller one.</p>;
  if (m.state === 'failed') return <p className="flex items-start gap-2 py-1 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />The {WORD[m.kind] ?? 'file'} could not be loaded from WhatsApp. Ask the customer to send it again.</p>;
  if (m.inline && (m.kind === 'image' || m.kind === 'sticker')) {
    // A signed-in file route: next/image's optimiser cannot fetch it, and the browser must send the session cookie itself.
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={url} target="_blank" rel="noreferrer noopener" className="block"><img src={url} alt={m.caption || `Customer's ${WORD[m.kind]}`} loading="lazy" className={m.kind === 'sticker' ? 'size-32 object-contain' : 'max-h-72 w-auto max-w-full rounded-lg object-contain'} /></a>;
  }
  if (m.inline && m.kind === 'audio') return <audio controls preload="none" src={url} className="h-10 w-60 max-w-full" aria-label="Voice message from the customer" />;
  if (m.inline && m.kind === 'video') return <video controls preload="metadata" src={url} className="max-h-72 w-full max-w-full rounded-lg" aria-label="Video from the customer" />;
  return (
    <a href={url} download className="flex min-h-11 items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm font-semibold underline-offset-2 hover:underline dark:bg-white/10">
      <FileText className="size-5 shrink-0" /><span className="min-w-0 truncate">{m.fileName || `Download ${WORD[m.kind] ?? 'file'}`}</span><span className="shrink-0 text-xs font-normal opacity-70">{size(m.sizeBytes)}</span>
    </a>
  );
}

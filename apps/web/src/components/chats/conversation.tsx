'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useEffect } from 'react';
import { Check, CheckCheck, ChevronLeft, Clock, CreditCard, FileText, Info, Paperclip, Send, StickyNote, Zap } from 'lucide-react';
import type { Chat, Msg } from '@/lib/demo-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { initials } from '@/components/chats/chat-list';

const quickReplies = [
  { k: '/price', t: 'Premium is ₹499 a month. Yearly is ₹4,999 (2 months free).' },
  { k: '/upi', t: 'Yes, you can pay by UPI from the payment link I sent.' },
  { k: '/thanks', t: 'Thank you! Let us know if you need anything else.' },
];

function Ticks({ tick }: { tick?: Msg['tick'] }) {
  if (tick === 'failed') return <span className="font-bold text-danger" aria-label="Not delivered">!</span>;
  if (tick === 'sent') return <Check className="size-3.5" aria-label="Sent" />;
  if (tick === 'delivered') return <CheckCheck className="size-3.5" aria-label="Delivered" />;
  if (tick === 'read') return <CheckCheck className="size-3.5 text-sky-500" aria-label="Read" />;
  return null;
}

export function Conversation({ chat }: { chat: Chat }) {
  const [messages, setMessages] = useState<Msg[]>(chat.messages);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState(false);
  const [panel, setPanel] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const open = chat.windowHoursLeft > 0;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const suggestions = useMemo(
    () => (draft.startsWith('/') ? quickReplies.filter((q) => q.k.startsWith(draft)) : []),
    [draft],
  );

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [...m, { id: `n${m.length}`, dir: 'out', text, time: 'Now', tick: note ? undefined : 'sent', note }]);
    setDraft('');
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-background md:static md:h-full md:min-w-0 md:flex-row md:gap-4">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden md:rounded-xl md:border md:border-border">
        <header className="flex items-center gap-2 border-b border-border bg-card px-2 py-2">
          <Link href="/chats" aria-label="Back to chats" className="flex size-11 items-center justify-center md:hidden">
            <ChevronLeft className="size-6" />
          </Link>
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">{initials(chat.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{chat.name}</p>
            <p className="truncate text-xs text-muted-foreground">{chat.phone}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Customer details" onClick={() => setPanel((p) => !p)} className="md:hidden">
            <Info className="size-5" />
          </Button>
          <label className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            Assigned to
            <select defaultValue={chat.assignee ?? ''} aria-label="Assign chat" className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground">
              <option value="">Unassigned</option>
              <option>You</option>
              <option>Priya</option>
              <option>Arjun</option>
            </select>
          </label>
          <Button variant="outline" size="sm" className="hidden md:inline-flex"><Check className="size-4" />Resolve</Button>
        </header>

        <div
          className={cn(
            'flex items-center gap-2 border-b border-border px-3 py-2 text-xs',
            open ? 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
          )}
        >
          <Clock className="size-4 shrink-0" />
          {open
            ? `You can reply freely for ${chat.windowHoursLeft}h.`
            : "This customer hasn't messaged in 24 hours. Send an approved message format."}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-muted/60 p-3" role="log" aria-label="Messages">
          {messages.map((m) => (
            <div key={m.id} className={cn('flex', m.dir === 'out' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                  m.note
                    ? 'border border-dashed border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
                    : m.dir === 'out'
                      ? 'rounded-br-sm bg-[#d9fdd3] text-slate-900 dark:bg-green-900 dark:text-green-50'
                      : 'rounded-bl-sm bg-card',
                )}
              >
                {m.note ? <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide">Private note, not sent</p> : null}
                <p className="whitespace-pre-wrap">{m.text}</p>
                <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                  {m.time}
                  {m.dir === 'out' && !m.note ? <Ticks tick={m.tick} /> : null}
                </p>
                {m.tick === 'failed' && m.error ? (
                  <div className="mt-1 rounded-lg bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
                    <p>{m.error}</p>
                    <button className="mt-1 min-h-11 font-semibold underline">Use a message format</button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>

        {suggestions.length > 0 ? (
          <ul className="border-t border-border bg-card">
            {suggestions.map((s) => (
              <li key={s.k}>
                <button className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm" onClick={() => setDraft(s.t)}>
                  <Zap className="size-4 text-primary" />
                  <span className="font-semibold">{s.k}</span>
                  <span className="truncate text-muted-foreground">{s.t}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="border-t border-border bg-card p-2">
          {!open && !note ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950">
              <span>Free replies are closed.</span>
              <Button size="sm">Pick a message format</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex gap-1 overflow-x-auto px-1 pb-1 text-xs">
                {[['Templates', FileText], ['Quick replies', Zap], ['Payment link', CreditCard]].map(([l, I]) => {
                  const Icon = I as typeof Zap;
                  return (
                    <button key={l as string} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 font-medium hover:bg-muted" onClick={() => l === 'Quick replies' && setDraft('/')}>
                      <Icon className="size-3.5" />{l as string}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-end gap-2">
                <Button variant="ghost" size="icon" aria-label="Attach a file"><Paperclip className="size-5" /></Button>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={note ? 'Write a private note' : 'Reply, or type / for shortcuts'}
                  aria-label="Message"
                  rows={1}
                  className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2.5 text-sm"
                />
                <Button variant={note ? 'outline' : 'ghost'} size="icon" aria-label="Switch to private note" onClick={() => setNote((n) => !n)}>
                  <StickyNote className="size-5" />
                </Button>
                <Button size="icon" aria-label="Send" onClick={send}><Send className="size-5" /></Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <aside
        aria-label="Customer details"
        className={cn(
          'w-full shrink-0 space-y-4 overflow-y-auto border-border bg-card p-4 md:block md:w-72 md:rounded-xl md:border',
          panel ? 'absolute inset-0 z-30 block md:static' : 'hidden',
        )}
      >
        <button className="min-h-11 font-semibold text-primary md:hidden" onClick={() => setPanel(false)}>Close</button>
        <div className="text-center">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/15 text-xl font-bold text-primary">{initials(chat.name)}</span>
          <p className="mt-2 font-semibold">{chat.name}</p>
          <p className="text-sm text-muted-foreground">{chat.phone}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Customer allowed messages</p>
          <Badge tone={chat.tags.includes('Stopped messages') ? 'red' : 'green'}>
            {chat.tags.includes('Stopped messages') ? 'Customer stopped messages' : 'Allowed'}
          </Badge>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {chat.tags.length ? chat.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>) : <span className="text-sm text-muted-foreground">No tags yet</span>}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Assigned to</p>
          <p className="text-sm">{chat.assignee ?? 'Nobody yet'}</p>
        </div>
        <Button variant="outline" className="w-full">Mark as resolved</Button>
      </aside>
    </div>
  );
}

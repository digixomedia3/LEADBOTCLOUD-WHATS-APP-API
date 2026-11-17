'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { ArrowLeft, CheckCheck, CheckCircle2, FlaskConical, Lock, MessageSquare, Send, StickyNote, UserCheck } from 'lucide-react';
import { formatPhone } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { addNote, assign, listConversations, openConversation, sendReply, setStatus, simulateInbound, type ConvRow, type MsgRow, type TeamMember } from '@/app/(app)/chats/actions';
import { cn } from '@/lib/utils';
import { MediaBubble } from './media-bubble';

type Filter = 'open' | 'mine' | 'unassigned' | 'resolved';
type QR = { id: string; shortcut: string; body: string };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`; if (m < 1440) return `${Math.floor(m / 60)}h`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
};
const initials = (n: string | null, p: string) => (n ? n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : p.slice(-2));

export function ChatsView({ initial, team, quick, me, canReply, live }: { initial: ConvRow[]; team: TeamMember[]; quick: QR[]; me: string; canReply: boolean; live: boolean }) {
  const [list, setList] = useState(initial);
  const [filter, setFilter] = useState<Filter>('open');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ conv: ConvRow; messages: MsgRow[] } | null>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const refreshList = useCallback(async (f: Filter = filter) => setList(await listConversations(f)), [filter]);
  const open = useCallback(async (id: string) => { setActiveId(id); setError(''); setThread(await openConversation(id)); void refreshList(); }, [refreshList]);
  useEffect(() => { void refreshList(filter); }, [filter, refreshList]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length]);
  // Light polling stands in for the realtime gateway until the worker exists.
  useEffect(() => { const t = setInterval(() => { void refreshList(); if (activeId) void openConversation(activeId).then(setThread); }, 8000); return () => clearInterval(t); }, [activeId, refreshList]);

  const c = thread?.conv;
  function send() {
    if (!activeId || !text.trim()) return;
    setError('');
    start(async () => {
      const r = mode === 'note' ? await addNote(activeId, text) : await sendReply(activeId, text);
      if (!r.ok) { setError(r.error); return; }
      setText(''); setThread(await openConversation(activeId)); void refreshList();
    });
  }
  const shortcutHits = text.startsWith('/') ? quick.filter((q) => q.shortcut.startsWith(text.slice(1).toLowerCase())) : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 rounded-xl border border-dashed border-amber/50 bg-amber/5 p-3 text-sm"><FlaskConical className="mt-0.5 size-4 shrink-0 text-amber" /><span><strong>Test mode.</strong> Replies stay in this panel. Use “Customer replies” to try the 24-hour window, STOP and auto-replies.</span></p>
      <div className="card grid h-[calc(100dvh-14.5rem)] min-h-[30rem] overflow-hidden p-0 md:h-[calc(100dvh-13rem)] lg:grid-cols-[21rem_minmax(0,1fr)_16rem]">
        {/* List */}
        <section className={cn('flex min-h-0 min-w-0 flex-col border-r border-line', activeId && 'hidden lg:flex')} aria-label="Conversations">
          <div className="flex gap-1.5 overflow-x-auto border-b border-line p-2" role="tablist">
            {([['open', 'Open'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['resolved', 'Resolved']] as const).map(([id, l]) => <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={cn('min-h-10 shrink-0 rounded-full px-3.5 text-sm font-semibold', filter === id ? 'grad-bg text-white' : 'text-muted hover:bg-ink/5')}>{l}</button>)}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 ? <li className="flex flex-col items-center p-10 text-center"><MessageSquare className="mb-2 size-9 text-muted" /><p className="font-semibold">No conversations</p><p className="mt-1 text-sm text-muted">Customers who reply to your messages appear here. Start one from Contacts.</p></li> : null}
            {list.map((r) => (
              <li key={r.id}><button onClick={() => void open(r.id)} className={cn('flex min-h-[4.5rem] w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left hover:bg-ink/[0.03]', activeId === r.id && 'bg-brand/10')}>
                <span className="grad-bg flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">{initials(r.name, r.phone)}</span>
                <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className={cn('truncate', r.unread ? 'font-extrabold' : 'font-semibold')}>{r.name ?? formatPhone(r.phone)}</span><span className="shrink-0 text-xs text-muted">{ago(r.lastAt)}</span></span>
                  <span className="flex items-center justify-between gap-2"><span className="truncate text-sm text-muted">{r.preview ?? 'No messages yet'}</span>{r.unread ? <span className="grad-bg flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white">{r.unread}</span> : null}</span></span>
              </button></li>))}
          </ul>
        </section>

        {/* Thread */}
        <section className={cn('flex min-h-0 min-w-0 flex-col', !activeId && 'hidden lg:flex')} aria-label="Conversation">
          {!c || !thread ? <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted"><MessageSquare className="mb-3 size-12" /><p className="font-semibold text-ink">Select a conversation</p></div> : (
            <>
              <header className="flex items-center gap-3 border-b border-line px-3 py-2.5">
                <button onClick={() => { setActiveId(null); setThread(null); }} aria-label="Back to list" className="flex size-11 items-center justify-center rounded-xl hover:bg-ink/5 lg:hidden"><ArrowLeft className="size-5" /></button>
                <span className="grad-bg flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">{initials(c.name, c.phone)}</span>
                <div className="min-w-0 flex-1"><p className="truncate font-bold">{c.name ?? formatPhone(c.phone)}</p><p className="truncate text-xs text-muted">{formatPhone(c.phone)} · {c.windowOpen ? <span className="text-brand">Reply window open</span> : <span className="text-amber">Window closed</span>}</p></div>
                {canReply ? <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await setStatus(c.id, c.status === 'open' ? 'resolved' : 'open'); setThread(await openConversation(c.id)); void refreshList(); flash(c.status === 'open' ? 'Marked resolved.' : 'Reopened.'); })}><CheckCircle2 className="size-4" /><span className="hidden sm:inline">{c.status === 'open' ? 'Resolve' : 'Reopen'}</span></Button> : null}
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efe7dd] p-4 dark:bg-[#0b141a]">
                {thread.messages.length === 0 ? <p className="py-8 text-center text-sm text-muted">No messages yet. {c.windowOpen ? '' : 'Send an approved template to reach this customer.'}</p> : null}
                {thread.messages.map((m) => (
                  <div key={m.id} className={cn('flex', m.direction === 'in' ? 'justify-start' : 'justify-end')}>
                    <div className={cn('max-w-[82%] rounded-xl px-3 py-2 text-[14px] leading-snug shadow-sm', m.direction === 'in' && 'rounded-tl-none bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]', m.direction === 'out' && 'rounded-tr-none bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]', m.direction === 'note' && 'border border-amber/50 bg-amber/15 text-ink')}>
                      {m.direction === 'note' ? <p className="mb-0.5 flex items-center gap-1 text-[11px] font-bold text-amber"><StickyNote className="size-3" />Private note</p> : null}
                      {m.media ? <MediaBubble media={m.media} /> : null}
                      {m.media ? (m.media.caption ? <p className="mt-1 whitespace-pre-wrap break-words">{m.media.caption}</p> : null) : <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] opacity-60">{new Date(m.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}{m.direction === 'out' ? <CheckCheck className="size-3.5 text-[#53bdeb]" /> : null}</p>
                    </div>
                  </div>))}
                <div ref={endRef} />
              </div>
              {canReply ? (
                <footer className="border-t border-line p-2.5">
                  {error ? <p role="alert" className="mb-2 rounded-lg bg-rose/10 px-3 py-2 text-sm text-rose">{error}</p> : null}
                  {!c.windowOpen && mode === 'reply' ? <p className="mb-2 flex items-center gap-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber"><Lock className="size-3.5 shrink-0" />The 24-hour window is closed. You can add private notes, or wait for the customer to write.</p> : null}
                  {shortcutHits.length ? <ul className="mb-2 max-h-32 overflow-y-auto rounded-xl border border-line bg-card text-sm">{shortcutHits.map((q) => <li key={q.id}><button className="flex min-h-11 w-full flex-col px-3 text-left hover:bg-ink/5" onClick={() => setText(q.body)}><span className="font-mono text-xs text-brand">/{q.shortcut}</span><span className="truncate">{q.body}</span></button></li>)}</ul> : null}
                  <div className="mb-1.5 flex gap-1.5">{(['reply', 'note'] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cn('min-h-9 rounded-full px-3.5 text-xs font-bold', mode === m ? (m === 'note' ? 'bg-amber/20 text-amber' : 'bg-brand/15 text-brand') : 'text-muted')}>{m === 'reply' ? 'Reply' : 'Private note'}</button>)}</div>
                  <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
                    <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1} placeholder={mode === 'note' ? 'Only your team sees this' : 'Type a message. Type / for quick replies'} aria-label="Message" className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-card px-3 py-2.5 text-base focus:border-brand" />
                    <Button type="submit" size="icon" disabled={pending || !text.trim() || (mode === 'reply' && !c.windowOpen)} aria-label="Send"><Send className="size-5" /></Button>
                  </form>
                </footer>) : <p className="border-t border-line p-3 text-center text-sm text-muted">Your role can view chats but not reply.</p>}
            </>)}
        </section>

        {/* Details */}
        <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 lg:flex" aria-label="Details">
          {c ? (
            <>
              <div className="text-center"><span className="grad-bg mx-auto flex size-16 items-center justify-center rounded-full text-xl font-bold text-white">{initials(c.name, c.phone)}</span><p className="mt-2 font-bold">{c.name ?? 'No name'}</p><p className="text-sm text-muted">{formatPhone(c.phone)}</p>
                <span className={cn('mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold', c.consent === 'allowed' ? 'bg-brand/15 text-brand' : c.consent === 'stopped' ? 'bg-rose/15 text-rose' : 'bg-amber/15 text-amber')}>{c.consent === 'allowed' ? 'Opted in' : c.consent === 'stopped' ? 'Opted out' : 'No record'}</span></div>
              {canReply ? <label className="flex flex-col gap-1.5 text-sm font-semibold"><span className="flex items-center gap-1.5"><UserCheck className="size-4" />Assigned to</span>
                <Select value={c.assignedTo ?? ''} onChange={(e) => start(async () => { const r = await assign(c.id, e.target.value || null); if (!r.ok) flash(r.error); setThread(await openConversation(c.id)); void refreshList(); })}><option value="">Unassigned</option>{team.map((t) => <option key={t.userId} value={t.userId}>{t.name}{t.userId === me ? ' (you)' : ''}</option>)}</Select></label> : null}
              {canReply && !live ? <div className="rounded-xl border border-dashed border-amber/50 p-3"><p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber"><FlaskConical className="size-3.5" />Test mode</p>
                <div className="flex flex-col gap-1.5">{['Hi, what are your plans?', 'What is the price?', 'STOP'].map((t) => <Button key={t} size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await simulateInbound(c.id, t); if (!r.ok) flash(r.error); else { flash(r.data.optedOut ? 'Customer opted out.' : r.data.autoReplied ? 'Auto-reply sent.' : 'Customer replied.'); setThread(await openConversation(c.id)); void refreshList(); } })}>Customer: “{t}”</Button>)}</div></div> : null}
            </>) : <p className="text-center text-sm text-muted">Select a conversation.</p>}
        </aside>
      </div>
      {toast ? <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg shadow-xl md:bottom-8">{toast}</div> : null}
    </div>
  );
}

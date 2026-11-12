'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { allNav } from '@/lib/nav';
import { cn } from '@/lib/utils';

const actions = [
  { label: 'Create campaign', href: '/campaigns', hint: 'Campaigns' },
  { label: 'Add or import contacts', href: '/contacts', hint: 'Contacts' },
  { label: 'New template', href: '/templates', hint: 'Templates' },
  { label: 'Open inbox', href: '/chats', hint: 'Chats' },
];

/** Ctrl or Cmd + K. Jump to any section or start a common task. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const all = [
      ...allNav.map((n) => ({ label: `Go to ${n.label}`, href: n.href, hint: 'Page' })),
      ...actions,
    ];
    const t = q.trim().toLowerCase();
    return t ? all.filter((i) => i.label.toLowerCase().includes(t) || i.hint.toLowerCase().includes(t)) : all;
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="card w-full max-w-lg overflow-hidden [animation:pop_0.18s_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && items[idx]) go(items[idx]!.href);
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 text-muted" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages and actions" aria-label="Search pages and actions" className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted" />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 ? <li className="p-6 text-center text-sm text-muted">Nothing matches. Try another word.</li> : null}
          {items.map((i, n) => (
            <li key={i.label}>
              <Link href={i.href} onClick={onClose} onMouseEnter={() => setIdx(n)} className={cn('flex min-h-11 items-center justify-between rounded-xl px-3 text-sm', n === idx ? 'bg-brand/10 text-brand' : 'hover:bg-ink/5')}>
                <span className="font-medium">{i.label}</span>
                <span className="flex items-center gap-2 text-xs text-muted">{i.hint}{n === idx ? <CornerDownLeft className="size-3.5" /> : null}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Accessible modal: bottom sheet on phones, centred card on desktop. Esc and backdrop close it. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Always call the newest onClose without making it a dependency. Many parents pass a fresh function on every render; if it were a dependency, every
  // keystroke in a form inside the dialog would re-run this effect, re-focus the dialog box and throw the cursor out of the field after one character.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; prev?.focus(); };
  }, [open]);
  // When a form inside the dialog reports a problem, bring it into view. The dialog body scrolls on a phone, so the message at its top would otherwise be
  // out of sight right when the person presses the button at the bottom, and it would look as if nothing happened.
  useEffect(() => {
    if (!open || !ref.current) return;
    const root = ref.current;
    const seen = new WeakSet<Element>();
    const reveal = () => {
      for (const el of root.querySelectorAll('[role="alert"]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        el.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    };
    reveal();
    const mo = new MutationObserver(reveal);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose} role="presentation">
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={cn('card flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-b-none outline-none sm:rounded-b-[1.25rem] [animation:sheet-in_0.25s_cubic-bezier(0.2,0.8,0.2,1)] sm:[animation:pop_0.18s_ease-out]', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center rounded-xl hover:bg-ink/5"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

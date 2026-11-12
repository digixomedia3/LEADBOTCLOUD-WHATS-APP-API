'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, LogOut, Plus } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { switchWorkspaceAction } from '@/app/onboarding/actions';
import { cn } from '@/lib/utils';

export interface WorkspaceInfo { id: string; name: string; role: string; plan: string }

/** Workspace switcher + account menu, shown at the bottom of the sidebar and in the phone More sheet. */
export function AccountMenu({ user, workspace, workspaces, collapsed, onDark }: {
  user: { name: string; email: string };
  workspace: WorkspaceInfo;
  workspaces: { id: string; name: string }[];
  collapsed?: boolean;
  onDark?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  async function logout() {
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={cn('flex min-h-11 w-full items-center gap-3 rounded-xl p-1.5 text-left', onDark ? 'hover:bg-white/10' : 'hover:bg-ink/5')}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">{workspace.name.slice(0, 1).toUpperCase()}</span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 text-xs"><span className={cn('block truncate font-semibold', onDark && 'text-white')}>{workspace.name}</span><span className={cn('block truncate capitalize', onDark ? 'text-white/60' : 'text-muted')}>{workspace.role} · {workspace.plan}</span></span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
          </>
        ) : null}
      </button>
      {open ? (
        <div role="menu" className={cn('card absolute z-50 w-64 overflow-hidden p-1.5 text-sm [animation:pop_0.15s_ease-out]', collapsed ? 'bottom-0 left-full ml-2' : 'bottom-full left-0 mb-2')}>
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Workspaces</p>
          {workspaces.map((w) => (
            <form key={w.id} action={switchWorkspaceAction.bind(null, w.id)}>
              <button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-ink/5">
                <span className="flex-1 truncate font-medium">{w.name}</span>{w.id === workspace.id ? <Check className="size-4 text-brand" /> : null}
              </button>
            </form>
          ))}
          <Link role="menuitem" href="/onboarding/new" className="flex min-h-11 items-center gap-2 rounded-lg px-3 hover:bg-ink/5"><Plus className="size-4" />New workspace</Link>
          <div className="my-1 h-px bg-line" />
          <p className="truncate px-3 py-1 text-xs text-muted">{user.email}</p>
          <button role="menuitem" onClick={logout} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left font-medium text-rose hover:bg-rose/10"><LogOut className="size-4" />Log out</button>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { acceptInvite } from '@/app/(app)/settings/actions';

export function InviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <FormError>{error}</FormError>
      <p className="text-sm text-muted">You were invited to join a LeadBotCloud workspace. Accept to see its contacts, chats and campaigns, based on your role.</p>
      <Button disabled={pending} onClick={() => start(async () => { const r = await acceptInvite(token); if (!r.ok) { setError(r.error); return; } router.push('/dashboard'); router.refresh(); })}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Accept invitation</Button>
    </div>
  );
}

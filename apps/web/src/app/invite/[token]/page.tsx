import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/auth/auth-frame';
import { InviteAccept } from '@/components/settings/invite-accept';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Join workspace' };
export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  return (
    <AuthFrame title="Join a workspace" subtitle={`Signed in as ${s.user.email}.`} footer={<Link href="/dashboard" className="font-semibold text-brand">Back to my dashboard</Link>}>
      <InviteAccept token={token} />
    </AuthFrame>
  );
}

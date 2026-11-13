import type { Metadata } from 'next';
import { AuthFrame } from '@/components/auth/auth-frame';
import { ResetForm } from '@/components/auth/reset-forms';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

/** Better Auth sends the user here with ?token=... when the link is good and ?error=INVALID_TOKEN when it is not. */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthFrame title="Choose a new password" subtitle="Use at least 8 characters. You will be signed out on all devices.">
      <ResetForm token={sp.token ?? null} invalid={!!sp.error} />
    </AuthFrame>
  );
}

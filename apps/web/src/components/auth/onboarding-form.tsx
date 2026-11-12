'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { BUSINESS_CATEGORIES } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { createWorkspaceAction, type OnboardingState } from '@/app/onboarding/actions';

export function OnboardingForm() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createWorkspaceAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state.error}</FormError>
      <Field label="Business name" hint="This is your workspace name. You can invite your team later."><Input name="businessName" required maxLength={100} placeholder="DiGiXO Store" autoComplete="organization" /></Field>
      <Field label="What does your business do?">
        <Select name="category" required defaultValue="">
          <option value="" disabled>Choose one</option>
          {BUSINESS_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </Field>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="accept" required className="mt-0.5 size-5 accent-[var(--brand)]" />
        <span>I agree to the <Link href="/terms" className="font-semibold text-brand" target="_blank">Terms</Link> and the <Link href="/terms#acceptable-use" className="font-semibold text-brand" target="_blank">Acceptable Use Policy</Link>. I will only message people who agreed to hear from me.</span>
      </label>
      <Button type="submit" disabled={pending} className="mt-1 w-full">{pending ? <Loader2 className="size-4 animate-spin" /> : null}Create my workspace</Button>
    </form>
  );
}

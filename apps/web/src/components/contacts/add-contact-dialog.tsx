'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { CONSENT_SOURCES } from '@lbc/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { addContact, type GroupRow } from '@/app/(app)/contacts/actions';

export function AddContactDialog({ open, onClose, groups, onDone }: { open: boolean; onClose: () => void; groups: GroupRow[]; onDone: (msg: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [sel, setSel] = useState<string[]>([]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError('');
    start(async () => {
      const r = await addContact({
        name: String(f.get('name') ?? ''), phone: String(f.get('phone') ?? ''), email: String(f.get('email') ?? ''),
        tags: String(f.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean), groupIds: sel, consent, source: String(f.get('source')) as (typeof CONSENT_SOURCES)[number],
      });
      if (!r.ok) { setError(r.error); return; }
      setConsent(false); setSel([]); onDone('Contact added.'); onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a contact">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormError>{error}</FormError>
        <Field label="Phone number" hint="10-digit Indian number, or add +country code for other countries."><Input name="phone" inputMode="tel" required autoFocus placeholder="98765 43210" /></Field>
        <Field label="Name"><Input name="name" placeholder="Asha Verma" /></Field>
        <Field label="Email (optional)"><Input name="email" type="email" /></Field>
        <Field label="Tags" hint="Separate with commas, for example: premium, yearly"><Input name="tags" /></Field>
        {groups.length ? (
          <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-semibold">Add to groups</legend>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <label key={g.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium ${sel.includes(g.id) ? 'border-brand bg-brand/10 text-brand' : 'border-line'}`}>
                  <input type="checkbox" className="sr-only" checked={sel.includes(g.id)} onChange={() => setSel(sel.includes(g.id) ? sel.filter((x) => x !== g.id) : [...sel, g.id])} />{g.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <Field label="Where did they agree to get messages?"><Select name="source" defaultValue={CONSENT_SOURCES[0]}>{CONSENT_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 accent-[var(--brand)]" />This customer agreed to receive WhatsApp messages from my business.</label>
        <Button type="submit" disabled={pending || !consent} className="w-full">{pending ? <Loader2 className="size-4 animate-spin" /> : null}Add contact</Button>
      </form>
    </Modal>
  );
}

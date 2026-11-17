'use client';

import { useEffect, useState, useTransition } from 'react';
import { FlaskConical, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { deleteTestNumber, loadTestNumbers, saveTestNumber, sendTest } from '@/app/(app)/campaigns/test-actions';
import type { TestNumber } from '@/lib/core/test-send';

/** "Send a test to my phone". The template, the blanks and the offer are exactly what is filled in above, so what arrives is what customers would get. */
export function TestSendPanel({ templateId, varMap, offerCode, offerEndsAt, ready, tracked }: { templateId: string; varMap: string[]; offerCode?: string; offerEndsAt?: string; ready: boolean; tracked: boolean }) {
  const [open, setOpen] = useState(false);
  const [nums, setNums] = useState<TestNumber[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [phone, setPhone] = useState(''); const [label, setLabel] = useState('My phone');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || nums) return;
    void loadTestNumbers().then((r) => { if (r.ok) { setNums(r.data); setPicked(r.data.slice(0, 1).map((n) => n.id)); } else setMsg({ ok: false, text: r.error }); });
  }, [open, nums]);

  const add = () => start(async () => {
    setMsg(null); const r = await saveTestNumber(phone, label);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setNums((o) => [...(o ?? []), r.data]); setPicked((o) => [...o, r.data.id]); setPhone('');
  });
  const remove = (id: string) => start(async () => {
    const r = await deleteTestNumber(id); if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setNums((o) => (o ?? []).filter((n) => n.id !== id)); setPicked((o) => o.filter((x) => x !== id));
  });
  const send = () => start(async () => {
    setMsg(null);
    const r = await sendTest({ templateId, numberIds: picked, varMap, offerCode: offerCode || undefined, offerEndsAt: offerEndsAt ? new Date(offerEndsAt).toISOString() : undefined });
    setMsg(r.ok ? { ok: true, text: `Sent to ${r.data.sent} number${r.data.sent === 1 ? '' : 's'}. It arrives within a minute. ${r.data.remainingThisHour} tests left this hour. It is a real message, so Meta may charge for it.` } : { ok: false, text: r.error });
  });

  return (
    <div className="rounded-xl border border-line p-3">
      <button type="button" className="flex w-full items-center gap-2 text-left text-sm font-semibold" aria-expanded={open} onClick={() => setOpen((o) => !o)}><FlaskConical className="size-4 text-indigo" aria-hidden />Send a test to my phone first</button>
      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          {tracked ? <p className="text-sm text-muted">This template has a tracked website button, which needs a campaign to count clicks. To test it, send a small campaign to a group that holds only your own numbers.</p> : (<>
            <p className="text-xs text-muted">A test is a real WhatsApp message to a number you saved below. Only saved numbers can receive tests, so it can never reach a customer by mistake.</p>
            {nums === null ? <p className="text-sm text-muted"><Loader2 className="mr-1 inline size-4 animate-spin" />Loading…</p> : (
              <ul className="flex flex-col gap-1.5">{nums.map((n) => (
                <li key={n.id} className="flex items-center gap-2 text-sm">
                  <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" className="size-4" checked={picked.includes(n.id)} onChange={(e) => setPicked((o) => (e.target.checked ? [...o, n.id] : o.filter((x) => x !== n.id)))} /><span className="min-w-0 truncate">{n.label} <span className="text-muted">{n.phone}</span></span></label>
                  <button type="button" aria-label={`Remove ${n.label}`} className="rounded-lg p-2 text-muted hover:bg-ink/5" disabled={pending} onClick={() => remove(n.id)}><Trash2 className="size-4" /></button>
                </li>))}</ul>)}
            {nums && nums.length < 5 ? (
              <div className="grid grid-cols-[1fr_7rem] gap-2 sm:grid-cols-[1fr_8rem_auto]">
                <Field label="Your phone number"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" maxLength={20} /></Field>
                <Field label="Name"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></Field>
                <div className="col-span-2 flex items-end sm:col-span-1"><Button variant="outline" className="w-full" disabled={pending || phone.trim().length < 6} onClick={add}>Save number</Button></div>
              </div>) : null}
            {msg ? <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-brand' : 'text-sm text-rose'}>{msg.text}</p> : null}
            <Button className="w-fit" disabled={pending || !ready || picked.length === 0} onClick={send}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Send test now</Button>
            {!ready ? <p className="text-xs text-muted">Fill in the blanks and offer details above first.</p> : null}
          </>)}
        </div>) : null}
    </div>
  );
}

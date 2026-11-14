'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { AlertTriangle, Bot, Check, Copy, KeyRound, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { API_SCOPES, DEFAULT_SCOPES, SCOPE_INFO, type ApiScope } from '@lbc/shared/api-scopes';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { createApiKey, listApiKeys, revokeApiKey, type KeyRow } from '@/app/(app)/settings/api-keys-actions';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : 'never');

export function ApiKeysPanel({ canManage }: { canManage: boolean }) {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<{ key: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const load = useCallback(() => { void listApiKeys().then(setKeys).catch(() => setError('Could not load keys. Refresh the page.')); }, []);
  useEffect(load, [load]);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5">
        <p className="flex items-center gap-2 font-display text-lg font-extrabold"><Bot className="size-5 text-brand" />Let an AI assistant run this for you</p>
        <p className="mt-1 text-sm text-muted">Create a key, give it to Claude, Hermes or another AI assistant, and just tell it what you want: “add these customers”, “make a campaign for Diwali”. The key only does what you allow, and you can switch it off any time.</p>
        <div className="mt-3 flex flex-wrap gap-2">{canManage ? <Button onClick={() => { setError(''); setOpen(true); }}><Plus className="size-4" />New key</Button> : <p className="text-sm text-muted">Only the owner or an admin can create keys.</p>}</div>
      </div>
      <FormError>{error}</FormError>

      <div className="card divide-y divide-line">
        {keys === null ? <p className="p-5 text-sm text-muted">Loading…</p> : keys.length === 0 ? <p className="p-5 text-sm text-muted">No keys yet.</p> : keys.map((k) => (
          <div key={k.id} className={cn('flex flex-col gap-2 p-4 sm:flex-row sm:items-center', k.revoked && 'opacity-55')}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold"><KeyRound className="size-4 text-muted" />{k.name}<code className="rounded bg-ink/5 px-1.5 py-0.5 text-xs">{k.prefix}…</code>{k.revoked ? <span className="rounded-full bg-red-500/10 px-2 text-[11px] font-bold uppercase text-red-600">Revoked</span> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <span className="rounded-full bg-amber/15 px-2 text-[11px] font-bold uppercase text-amber">Expired</span> : null}</p>
              <p className="mt-1 text-xs text-muted">Last used {when(k.lastUsedAt)} · {k.expiresAt ? `expires ${when(k.expiresAt)}` : 'never expires'}</p>
              <p className="mt-1 flex flex-wrap gap-1">{k.scopes.map((s) => <span key={s} className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', SCOPE_INFO[s as ApiScope]?.risk === 'spend' ? 'bg-red-500/10 text-red-600' : 'bg-ink/5')}>{SCOPE_INFO[s as ApiScope]?.label ?? s}</span>)}</p>
              {k.scopes.includes('campaigns:send') ? <p className="mt-1 text-xs text-muted">Can start sends up to ₹{k.sendCapRupees.toLocaleString('en-IN')} each and ₹{(k.sendCapRupees * 3).toLocaleString('en-IN')} a day.</p> : null}
            </div>
            {canManage && !k.revoked ? <Button variant="outline" size="sm" disabled={pending} onClick={() => { if (confirm(`Switch off “${k.name}”? Anything using it stops working immediately.`)) start(async () => { const r = await revokeApiKey(k.id); if (!r.ok) setError(r.error); else load(); }); }}><Trash2 className="size-4" />Switch off</Button> : null}
          </div>
        ))}
      </div>

      <div className="card p-5 text-sm">
        <p className="font-semibold">Connect it</p>
        <p className="mt-1 text-muted">In Claude (or any assistant that supports MCP) add a remote server:</p>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-ink/5 p-3 text-xs">{`URL:     ${origin}/api/mcp\nHeader:  Authorization: Bearer <your key>`}</pre>
        <p className="mt-3 text-muted">Or use the REST API: <code className="rounded bg-ink/5 px-1">{origin}/api/v1/…</code> with the same header.</p>
      </div>

      <NewKeyModal open={open} onClose={() => setOpen(false)} onCreated={(key, name) => { setOpen(false); setShown({ key, name }); load(); }} />
      <Modal open={!!shown} onClose={() => setShown(null)} title="Your new key">
        {shown ? <KeyShown k={shown.key} name={shown.name} origin={origin} onDone={() => setShown(null)} /> : null}
      </Modal>
    </div>
  );
}

function KeyShown({ k, name, origin, onDone }: { k: string; name: string; origin: string; onDone: () => void }) {
  const [copied, setCopied] = useState('');
  const copy = async (what: string, text: string) => { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 2000); };
  const claude = `claude mcp add --transport http leadbotcloud ${origin}/api/mcp --header "Authorization: Bearer ${k}"`;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex gap-2 rounded-xl bg-amber/10 p-3 text-sm text-amber"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Copy this now. For your safety we cannot show it again. If you lose it, switch it off and make a new one.</p>
      <p className="text-sm font-semibold">{name}</p>
      <code className="break-all rounded-xl bg-ink/5 p-3 text-xs">{k}</code>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy('key', k)}>{copied === 'key' ? <Check className="size-4" /> : <Copy className="size-4" />}Copy key</Button>
        <Button variant="outline" onClick={() => void copy('cmd', claude)}>{copied === 'cmd' ? <Check className="size-4" /> : <Copy className="size-4" />}Copy command for Claude Code</Button>
      </div>
      <Button variant="outline" onClick={onDone}>I have saved it</Button>
    </div>
  );
}

function NewKeyModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([...DEFAULT_SCOPES]);
  const [cap, setCap] = useState('500');
  const [days, setDays] = useState('90');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const canSend = scopes.includes('campaigns:send');
  const toggle = (s: ApiScope) => setScopes((o) => { const on = o.includes(s); const next = on ? o.filter((x) => x !== s) : [...o, s]; return next.includes('campaigns:send') && !next.includes('campaigns:write') ? [...next, 'campaigns:write'] : next; });
  useEffect(() => { if (open) { setName(''); setScopes([...DEFAULT_SCOPES]); setCap('500'); setDays('90'); setError(''); } }, [open]);
  const submit = () => start(async () => {
    setError('');
    const r = await createApiKey({ name, scopes, sendCapRupees: Number(cap) || 0, expiresInDays: days === 'never' ? null : Number(days) });
    if (!r.ok) { setError(r.error); return; }
    onCreated(r.data.key, name);
  });
  return (
    <Modal open={open} onClose={onClose} title="New API key">
      <div className="flex flex-col gap-4">
        <FormError>{error}</FormError>
        <Field label="Name" hint="So you remember what uses it"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude" maxLength={80} autoFocus /></Field>
        <fieldset><legend className="mb-2 text-sm font-semibold">What may it do?</legend>
          <div className="flex flex-col gap-1.5">{API_SCOPES.map((s) => (
            <label key={s} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm', scopes.includes(s) ? 'border-brand bg-brand/10' : 'border-line', SCOPE_INFO[s].risk === 'spend' && 'border-red-500/40')}>
              <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={scopes.includes(s)} onChange={() => toggle(s)} />
              <span className="flex-1">{SCOPE_INFO[s].label}</span>{SCOPE_INFO[s].risk === 'spend' ? <ShieldAlert className="size-4 text-red-600" /> : null}
            </label>))}</div>
        </fieldset>
        {canSend ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm">
            <p className="font-semibold text-red-600">This key can message your customers and spend money.</p>
            <Field label="Most one send may cost (₹, incl. GST)" hint={`Each send above this is refused. In any 24 hours it can start at most ₹${(Number(cap) * 3 || 0).toLocaleString('en-IN')} in total.`}><Input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} /></Field>
            <p className="mt-2 text-xs text-muted">It can only start sends it created itself. Anything it sends still skips people who opted out.</p>
          </div>
        ) : <p className="text-xs text-muted">Without the sending permission, the assistant can prepare a campaign but cannot send it. You press Send yourself.</p>}
        <Field label="Switch off automatically after"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="never">Never</option></Select></Field>
        <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button className="flex-1" disabled={pending || name.trim().length < 2 || scopes.length === 0} onClick={submit}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Create key</Button></div>
      </div>
    </Modal>
  );
}

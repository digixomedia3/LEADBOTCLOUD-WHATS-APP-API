'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Facebook, FileSpreadsheet, Loader2, ShoppingBag, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { choosePage, disconnect, listConnections, pendingPages, setSheet, type ConnectionRow, type ConnectionsData } from '@/app/(app)/connections/actions';
import { cn } from '@/lib/utils';

const META = {
  meta_lead_ads: { name: 'Facebook and Instagram Lead Ads', Icon: Facebook, what: 'Every Lead Ad form fill arrives in your inbox within seconds, with the ad it came from.' },
  shopify: { name: 'Shopify', Icon: ShoppingBag, what: 'New customers, orders and abandoned checkouts become leads with the order details.' },
  google_sheets: { name: 'Google Sheets', Icon: FileSpreadsheet, what: 'New rows in a sheet become leads. Read-only: we never change your sheet.' },
} as const;
const MESSAGES: Record<string, string> = {
  ok_shopify: 'Shopify store connected.', ok_google: 'Google account connected. Now choose the sheet to read.',
  denied: 'You cancelled on the other site. Nothing was connected.', state: 'That connection link expired or was already used. Start again.', role: 'Only an owner or admin can connect apps.',
  not_configured: 'This app is not set up on this installation yet.', bad_shop: 'Enter your store address like my-store.myshopify.com.', hmac: 'Shopify’s signature did not check out. Nothing was connected.',
  shop: 'The store did not match the one you started with. Start again.', no_refresh: 'Google did not give long-term access. Remove this app at myaccount.google.com/permissions, then connect again.',
  no_account: 'Google did not identify the account. Try again.', perm: 'Lead access was not granted. Connect again and tick every permission box.', no_pages: 'No Facebook Pages were found for this login.',
  in_use: 'That account is already connected to another workspace.', unreachable: 'Could not reach the other site. Try again in a minute.', provider: 'The other site refused the connection. Check the permissions and try again.', failed: 'Something went wrong. Try again.',
};
const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : 'Not yet');

export function ConnectionsView({ initial, flash }: { initial: ConnectionsData; flash: { ok: string | null; err: string | null; pick: string | null } }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [shop, setShop] = useState('');
  const [sheetFor, setSheetFor] = useState<ConnectionRow | null>(null);
  const [pick, setPick] = useState<{ token: string; pages: { id: string; name: string }[] } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(flash.ok ? { kind: 'ok', text: MESSAGES[flash.ok] ?? 'Connected.' } : flash.err ? { kind: 'err', text: MESSAGES[flash.err] ?? 'Something went wrong.' } : null);
  const [pending, start] = useTransition();
  const reload = async () => setData(await listConnections());

  useEffect(() => {
    if (!flash.pick) return;
    void pendingPages(flash.pick).then((r) => { if (r.ok) setPick({ token: flash.pick!, pages: r.data.pages }); else setMsg({ kind: 'err', text: r.error }); });
    router.replace('/connections');
  }, [flash.pick, router]);
  useEffect(() => { if (flash.ok === 'ok_google') void listConnections().then((d) => { setData(d); const g = d.rows.find((x) => x.provider === 'google_sheets' && !x.config.spreadsheetId); if (g) setSheetFor(g); }); }, [flash.ok]);

  const connected = (p: string) => data.rows.filter((r) => r.provider === p);
  const needsAttention = data.rows.filter((r) => r.status === 'needs_reauth').length;

  return (
    <div className="flex flex-col gap-5">
      <div><h2 className="font-display text-2xl font-extrabold">Connections</h2><p className="text-sm text-muted">Bring leads in from the places you already advertise and sell. Leads are never treated as permission to send marketing. Consent is set per source.</p></div>
      {msg ? <p role={msg.kind === 'err' ? 'alert' : 'status'} className={cn('rounded-xl p-3 text-sm', msg.kind === 'ok' ? 'bg-brand/10 text-brand' : 'bg-rose/10 text-rose')}>{msg.text}</p> : null}
      {needsAttention > 0 ? <p className="flex items-center gap-2 rounded-xl bg-amber/10 p-3 text-sm text-amber"><AlertTriangle className="size-4 shrink-0" />{needsAttention} connection{needsAttention > 1 ? 's need' : ' needs'} to be connected again. No new leads arrive from {needsAttention > 1 ? 'them' : 'it'} until then.</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(META) as (keyof typeof META)[]).map((p) => {
          const { name, Icon, what } = META[p]; const av = data.availability[p];
          return (
            <section key={p} className="card flex flex-col gap-3 p-4" aria-label={name}>
              <div className="flex items-center gap-3"><span className="grad-bg flex size-11 items-center justify-center rounded-xl text-white"><Icon className="size-5" /></span><h3 className="font-semibold leading-tight">{name}</h3></div>
              <p className="text-sm text-muted">{what}</p>
              {!av.ready ? <p className="rounded-xl bg-ink/5 p-3 text-xs text-muted">{av.why} The operator adds it in the server settings, then this button turns on.</p> : null}
              {data.canManage ? (
                p === 'shopify' ? (
                  <form action="/api/connect/shopify/start" method="get" className="mt-auto flex flex-col gap-2">
                    <Input name="shop" value={shop} onChange={(e) => setShop(e.target.value)} placeholder="my-store.myshopify.com" aria-label="Shopify store address" disabled={!av.ready} />
                    <Button type="submit" disabled={!av.ready || !shop.trim()}>Connect a store</Button>
                  </form>
                ) : <Button asChild={av.ready} disabled={!av.ready} className="mt-auto">{av.ready ? <a href={`/api/connect/${p}/start`}>{connected(p).length ? 'Connect another' : 'Connect'}</a> : <span>Connect</span>}</Button>
              ) : <p className="mt-auto text-xs text-muted">Ask an owner or admin to connect.</p>}
            </section>
          );
        })}
      </div>

      <section aria-label="Connected">
        <h3 className="mb-3 font-display text-lg font-bold">Connected</h3>
        {data.rows.length === 0 ? <div className="card p-8 text-center text-sm text-muted">Nothing connected yet. You can already capture leads with forms, QR codes and CSV import on the Leads page.</div> : (
          <ul className="grid gap-3 md:grid-cols-2">
            {data.rows.map((r) => {
              const { Icon, name } = META[r.provider];
              return (
                <li key={r.id} className="card flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3"><Icon className="size-5 shrink-0 text-brand" /><div className="min-w-0"><p className="truncate font-semibold">{r.label}</p><p className="text-xs text-muted">{name}</p></div></div>
                    {r.status === 'active' ? <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-bold text-brand"><CheckCircle2 className="size-3.5" />Working</span> : <span className="shrink-0 rounded-full bg-amber/15 px-2.5 py-1 text-xs font-bold text-amber">Connect again</span>}
                  </div>
                  <p className="text-xs text-muted">{r.leads} lead{r.leads === 1 ? '' : 's'} · Last activity: {ago(r.lastSyncAt)}</p>
                  {r.provider === 'google_sheets' ? <p className="break-all text-xs text-muted">{r.config.spreadsheetId ? <>Reading tab “{r.config.sheet ?? 'Sheet1'}” of sheet …{r.config.spreadsheetId.slice(-6)}</> : <span className="font-semibold text-amber">No sheet chosen yet.</span>}</p> : null}
                  {r.lastError ? <p className="rounded-lg bg-rose/10 p-2 text-xs text-rose">{r.lastError}</p> : null}
                  {data.canManage ? (
                    <div className="mt-1 flex flex-wrap gap-2 border-t border-line pt-3">
                      {r.status === 'needs_reauth' ? <Button size="sm" asChild><a href={r.provider === 'shopify' ? `/api/connect/shopify/start?shop=${encodeURIComponent(r.externalId)}` : `/api/connect/${r.provider}/start`}>Connect again</a></Button> : null}
                      {r.provider === 'google_sheets' ? <Button size="sm" variant="outline" onClick={() => setSheetFor(r)}>{r.config.spreadsheetId ? 'Change sheet' : 'Choose sheet'}</Button> : null}
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm(`Disconnect ${r.label}? New leads stop arriving. Leads you already have stay.`)) start(async () => { const x = await disconnect(r.id); setMsg(x.ok ? { kind: 'ok', text: 'Disconnected.' } : { kind: 'err', text: x.error }); await reload(); }); }}><Unplug className="size-4" />Disconnect</Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sheetFor ? <SheetModal conn={sheetFor} onClose={() => setSheetFor(null)} onSaved={async () => { setSheetFor(null); setMsg({ kind: 'ok', text: 'Sheet saved. New rows are read every couple of minutes.' }); await reload(); }} /> : null}
      {pick ? (
        <Modal open onClose={() => setPick(null)} title="Choose a Facebook Page">
          <p className="mb-3 text-sm text-muted">Leads from this Page’s Lead Ad forms will arrive in your inbox. You can connect more Pages afterwards.</p>
          <ul className="flex flex-col gap-2">{pick.pages.map((p) => (
            <li key={p.id}><Button variant="outline" className="w-full justify-start" disabled={pending} onClick={() => start(async () => { const r = await choosePage(pick.token, p.id); setPick(null); setMsg(r.ok ? { kind: 'ok', text: `${p.name} connected.` } : { kind: 'err', text: r.error }); await reload(); })}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Facebook className="size-4" />}{p.name}</Button></li>
          ))}</ul>
        </Modal>
      ) : null}
    </div>
  );
}

function SheetModal({ conn, onClose, onSaved }: { conn: ConnectionRow; onClose: () => void; onSaved: () => void }) {
  const [link, setLink] = useState(''); const [tab, setTab] = useState(conn.config.sheet ?? 'Sheet1'); const [err, setErr] = useState(''); const [pending, start] = useTransition();
  return (
    <Modal open onClose={onClose} title="Choose the sheet to read">
      <div className="flex flex-col gap-3">
        <Field label="Google Sheet link" hint="Open the sheet in Google Sheets and copy the address from the browser. The first row must have column names such as Name and Phone."><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /></Field>
        <Field label="Tab name"><Input value={tab} onChange={(e) => setTab(e.target.value)} maxLength={60} /></Field>
        <p className="text-xs text-muted">Only rows added after you save are read. Each row is read once.</p>
        {err ? <p role="alert" className="rounded-lg bg-rose/10 p-2 text-sm text-rose">{err}</p> : null}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={pending || !link.trim()} onClick={() => start(async () => { const r = await setSheet(conn.id, { link, tab }); if (!r.ok) setErr(r.error); else onSaved(); })}>Save</Button></div>
      </div>
    </Modal>
  );
}

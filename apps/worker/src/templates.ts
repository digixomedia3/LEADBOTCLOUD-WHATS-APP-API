import { sql } from 'drizzle-orm';
import { errorPolicy } from '@lbc/shared';
import { GraphClient, MetaError, MetaUnknownOutcome, TemplateBuildError, buildTemplatePayload, decryptSecret, mapRemoteCategory, mapRemoteQuality, mapRemoteStatus, parseRemoteTemplate, type LocalTemplate, type RemoteTemplate } from '@lbc/meta';
import type { Db } from '@lbc/db';

type Row = Record<string, unknown>;
const rows = (r: unknown) => r as Row[];

export interface TplDeps { db: Db; graph: GraphClient; tokenKey: string }

/** A connected, healthy account with a readable token, or null. */
async function account(db: Db, tenantId: string, key: string) {
  const a = rows(await db.execute(sql`select messaging_account_id, business_token_enc from meta_accounts where tenant_id = ${tenantId} and token_status = 'valid' and health_state = 'ok' limit 1`))[0];
  if (!a) return null;
  try { return { waba: String(a.messaging_account_id), token: decryptSecret(String(a.business_token_enc), key) }; } catch { return null; }
}

const STUCK_AFTER = 3;

/** Plain-language reason for a Meta refusal while creating a format. Unknown codes get a generic line, never a guess. */
function submitMessage(e: MetaError): string {
  const sub = e.graph.error_subcode;
  if (e.code === 100 && sub === 2388024) return 'A format with this name and language already exists in your WhatsApp account. Rename this one.';
  if (e.code === 100 && sub === 2388023) return 'Meta says this name was used and deleted in the last 30 days. Choose a different name.';
  const detail = e.graph.error_data?.details;
  if (detail) return String(detail).slice(0, 300);
  return errorPolicy(e.code).en ?? 'Meta did not accept this format. Check the wording and try again.';
}

/**
 * Sends formats the owner submitted (status 'pending', no Meta id yet) to Meta. Safe to run repeatedly: creating a format is idempotent
 * by name + language on Meta's side (a repeat returns 'already exists'), and sync adopts it.
 */
export async function submitPendingTemplates(d: TplDeps, limit = 20): Promise<{ sent: number; failed: number; waiting: number }> {
  const todo = rows(await d.db.execute(sql`select * from templates where status = 'pending' and meta_template_id is null order by submit_requested_at nulls first limit ${limit}`));
  let sent = 0, failed = 0, waiting = 0;
  for (const t of todo) {
    const id = String(t.id), tenantId = String(t.tenant_id);
    const acc = await account(d.db, tenantId, d.tokenKey);
    if (!acc) { waiting++; continue; } // not connected right now: stays pending, nothing is lost
    const claimed = rows(await d.db.execute(sql`update templates set submit_attempts = submit_attempts + 1 where id = ${id} and tenant_id = ${tenantId} and status = 'pending' and meta_template_id is null returning submit_attempts`))[0];
    if (!claimed) continue;

    const local: LocalTemplate = { name: String(t.name), language: String(t.language), category: String(t.category) as LocalTemplate['category'], headerText: (t.header_text as string | null) ?? null, body: String(t.body), footer: (t.footer as string | null) ?? null, buttons: (t.buttons as LocalTemplate['buttons']) ?? [], samples: (t.samples as string[]) ?? [] };
    let payload;
    try { payload = buildTemplatePayload(local); }
    catch (e) {
      const msg = e instanceof TemplateBuildError ? e.message : 'This format could not be prepared.';
      await d.db.execute(sql`update templates set status = 'draft', submit_error = ${msg}, updated_at = now() where id = ${id} and tenant_id = ${tenantId}`);
      failed++; continue;
    }
    try {
      const res = await d.graph.createTemplate(acc.waba, acc.token, payload);
      const st = mapRemoteStatus(res.status) ?? 'pending';
      const cat = mapRemoteCategory(res.category) ?? local.category;
      await d.db.execute(sql`update templates set meta_template_id = ${res.id}, category_current = ${cat}, status = ${st}, submit_error = null, rejection_reason = ${st === 'rejected' ? 'NONE' : null}, updated_at = now() where id = ${id} and tenant_id = ${tenantId}`);
      sent++;
    } catch (e) {
      if (e instanceof MetaUnknownOutcome) { waiting++; continue; } // might have been created; the next pass or the sync will find it by name
      if (e instanceof MetaError) {
        const dup = e.code === 100 && e.graph.error_subcode === 2388024;
        const attempts = Number(claimed.submit_attempts);
        if (e.isTransient || e.policy.retry === 'retry' || e.policy.retry === 'retry_delay' || (dup && attempts < STUCK_AFTER)) { waiting++; continue; }
        await d.db.execute(sql`update templates set status = 'draft', submit_error = ${submitMessage(e)}, updated_at = now() where id = ${id} and tenant_id = ${tenantId}`);
        if (e.policy.action === 'reconnect') await d.db.execute(sql`update meta_accounts set token_status = 'invalid', updated_at = now() where tenant_id = ${tenantId}`);
        failed++; continue;
      }
      throw e;
    }
  }
  return { sent, failed, waiting };
}

/** Deletes at Meta the formats the owner removed here. The row goes only after Meta agrees (or it never reached Meta). */
export async function deleteQueuedTemplates(d: TplDeps, limit = 20): Promise<number> {
  const todo = rows(await d.db.execute(sql`select id, tenant_id, name, meta_template_id from templates where status = 'deleting' order by updated_at limit ${limit}`));
  let done = 0;
  for (const t of todo) {
    const id = String(t.id), tenantId = String(t.tenant_id);
    if (!t.meta_template_id) { await d.db.execute(sql`delete from templates where id = ${id} and tenant_id = ${tenantId}`); done++; continue; }
    const acc = await account(d.db, tenantId, d.tokenKey);
    if (!acc) continue;
    try { await d.graph.deleteTemplate(acc.waba, acc.token, String(t.name)); await d.db.execute(sql`delete from templates where id = ${id} and tenant_id = ${tenantId}`); done++; }
    catch (e) {
      if (e instanceof MetaError && !e.isTransient) await d.db.execute(sql`update templates set submit_error = ${submitMessage(e)}, updated_at = now() where id = ${id} and tenant_id = ${tenantId}`);
    }
  }
  return done;
}

export interface SyncResult { seen: number; updated: number; imported: number; skipped: number; adopted: number }

/**
 * Pulls the formats from Meta and reconciles (spec 7.1 "Sync job"). Meta is the truth for status, category and quality.
 * Rows still being edited here (draft) are never overwritten. Formats we can not represent are counted, never imported half-way.
 */
export async function syncTemplates(d: TplDeps, tenantId: string): Promise<SyncResult | null> {
  const acc = await account(d.db, tenantId, d.tokenKey);
  if (!acc) return null;
  const remote: RemoteTemplate[] = [];
  let after: string | undefined;
  for (let page = 0; page < 30; page++) {
    const r = await d.graph.listTemplates(acc.waba, acc.token, after);
    remote.push(...(r.data ?? []));
    after = r.paging?.cursors?.after;
    if (!r.paging?.next || !after) break;
  }
  const out: SyncResult = { seen: remote.length, updated: 0, imported: 0, skipped: 0, adopted: 0 };
  const seenKeys = new Set<string>();

  for (const r of remote) {
    seenKeys.add(`${r.name}|${r.language}`);
    const status = mapRemoteStatus(r.status);
    const cat = mapRemoteCategory(r.category);
    const local = rows(await d.db.execute(sql`select id, status, meta_template_id from templates where tenant_id = ${tenantId} and name = ${r.name} and (language = ${r.language} or language = split_part(${r.language}, '_', 1)) limit 1`))[0];
    if (local) {
      if (local.status === 'draft' || local.status === 'deleting') continue; // being edited or removed here
      if (!status) { out.skipped++; continue; } // a status we do not know: leave it, never guess
      const adopt = !local.meta_template_id;
      await d.db.execute(sql`update templates set status = ${status}, meta_template_id = coalesce(${r.id ?? null}, meta_template_id), category_current = coalesce(${cat}, category_current), quality = ${mapRemoteQuality(r.quality_score?.score)}, submit_error = null, updated_at = now() where id = ${local.id} and tenant_id = ${tenantId}`);
      adopt ? out.adopted++ : out.updated++;
      continue;
    }
    const parsed = parseRemoteTemplate(r);
    if (!parsed || !status) { out.skipped++; continue; }
    await d.db.execute(sql`insert into templates (tenant_id, name, language, category, status, header_type, header_text, body, footer, buttons, samples, quality, meta_template_id, category_current)
      values (${tenantId}, ${parsed.name}, ${parsed.language}, ${parsed.category}, ${status}, ${parsed.headerText ? 'text' : 'none'}, ${parsed.headerText ?? null}, ${parsed.body}, ${parsed.footer ?? null}, ${JSON.stringify(parsed.buttons)}::jsonb, ${JSON.stringify(parsed.samples)}::jsonb, ${mapRemoteQuality(r.quality_score?.score)}, ${r.id ?? null}, ${parsed.category})
      on conflict (tenant_id, name, language) do nothing`);
    out.imported++;
  }

  // A submitted format that Meta still does not list after several tries is stuck (for example a name Meta blocks): hand it back with a reason.
  await d.db.execute(sql`update templates set status = 'draft', submit_error = 'Meta did not accept this format. Rename it or change the wording, then submit again.', updated_at = now()
    where tenant_id = ${tenantId} and status = 'pending' and meta_template_id is null and submit_attempts >= ${STUCK_AFTER}`);
  await d.db.execute(sql`update meta_accounts set templates_synced_at = now() where tenant_id = ${tenantId}`);
  return out;
}

/** Tenants whose formats should be synced now: connected, and not synced in the last `everyMinutes`. */
export async function tenantsDueForSync(db: Db, everyMinutes = 360) {
  return rows(await db.execute(sql`select tenant_id from meta_accounts where token_status = 'valid' and health_state = 'ok' and (templates_synced_at is null or templates_synced_at < now() - make_interval(mins => ${everyMinutes})) limit 50`)).map((r) => String(r.tenant_id));
}

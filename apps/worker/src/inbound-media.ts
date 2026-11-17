import { sql } from 'drizzle-orm';
import type { Db } from '@lbc/db';
import { GraphClient, MediaTooLarge, MetaError, MetaUnknownOutcome, decryptSecret } from '@lbc/meta';
import { MAX_ATTEMPTS, MAX_INBOUND_BYTES, isPermanentFailure, retryDelayMs } from '@lbc/shared/inbound-media';

/**
 * Downloads the files customers send (P8). The webhook only gives a media id, and the link Meta then gives expires within minutes, so the
 * file is fetched here and stored. Each pass claims due rows in the database itself (FOR UPDATE SKIP LOCKED), so two workers never fetch
 * the same file, and a crash just leaves the row due for the next pass.
 */
export interface MediaDeps { db: Db; graph: GraphClient; tokenKey: string; now?: () => Date }
const rows = (r: unknown) => r as Record<string, any>[];
export interface MediaTick { due: number; stored: number; failed: number; retrying: number; tooLarge: number }

export async function tickInboundMedia(d: MediaDeps, limit = 10): Promise<MediaTick> {
  const out: MediaTick = { due: 0, stored: 0, failed: 0, retrying: 0, tooLarge: 0 };
  // Claim: push next_try_at forward first, so a crash mid-download cannot make the same row look due to a second worker at once.
  const claimed = rows(await d.db.execute(sql`
    update inbound_media set next_try_at = now() + interval '5 minutes'
    where id in (select id from inbound_media where state = 'pending' and next_try_at <= now() order by next_try_at, created_at limit ${limit} for update skip locked)
    returning id, tenant_id, meta_media_id, kind, mime as claimed_mime, file_name, attempts`));
  out.due = claimed.length;
  for (const r of claimed) {
    const id = String(r.id), tenantId = String(r.tenant_id);
    const fail = async (message: string, permanent: boolean) => {
      const attempts = Number(r.attempts) + 1;
      if (permanent || attempts >= MAX_ATTEMPTS) { await d.db.execute(sql`update inbound_media set state = 'failed', attempts = ${attempts}, error = ${message.slice(0, 300)} where id = ${id} and tenant_id = ${tenantId}`); out.failed++; }
      else { await d.db.execute(sql`update inbound_media set attempts = ${attempts}, error = ${message.slice(0, 300)}, next_try_at = now() + (${retryDelayMs(attempts)} || ' milliseconds')::interval where id = ${id} and tenant_id = ${tenantId}`); out.retrying++; }
    };
    try {
      // Each file is fetched with the token of the workspace that received it, never another's.
      const acc = rows(await d.db.execute(sql`select a.business_token_enc from meta_accounts a join messages m on m.tenant_id = a.tenant_id where a.tenant_id = ${tenantId} and m.id = (select message_id from inbound_media where id = ${id}) limit 1`))[0];
      if (!acc?.business_token_enc) { await fail('WhatsApp is not connected, so the file could not be fetched.', false); continue; }
      const token = decryptSecret(String(acc.business_token_enc), d.tokenKey);
      const info = await d.graph.getMediaInfo(String(r.meta_media_id), token);
      if (!info.url) { await fail('Meta did not give a download link.', false); continue; }
      if (typeof info.file_size === 'number' && info.file_size > MAX_INBOUND_BYTES) throw new MediaTooLarge(info.file_size);
      const got = await d.graph.downloadMedia(info.url, token, MAX_INBOUND_BYTES);
      if (!got.bytes.byteLength) { await fail('The file was empty.', false); continue; }
      const mime = (info.mime_type ?? got.mime ?? r.claimed_mime ?? null) as string | null;
      await d.db.execute(sql`update inbound_media set state = 'stored', data = ${Buffer.from(got.bytes)}, size_bytes = ${got.bytes.byteLength}, mime = ${mime}, error = null, stored_at = now(), attempts = attempts + 1 where id = ${id} and tenant_id = ${tenantId} and state = 'pending'`);
      out.stored++;
    } catch (e) {
      if (e instanceof MediaTooLarge) { await d.db.execute(sql`update inbound_media set state = 'too_large', size_bytes = ${e.size}, error = ${'File is over 16 MB.'}, attempts = attempts + 1 where id = ${id} and tenant_id = ${tenantId}`); out.tooLarge++; }
      else if (e instanceof MetaError) await fail(`Meta said: ${e.message}`.slice(0, 300), isPermanentFailure(e.status));
      else if (e instanceof MetaUnknownOutcome) await fail('Could not reach Meta. Will try again.', false);
      else await fail(`Unexpected error: ${(e as Error).message}`, false);
    }
  }
  return out;
}

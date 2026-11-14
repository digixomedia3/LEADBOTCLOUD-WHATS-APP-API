import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));
let role: 'owner' | 'admin' | 'agent' | 'viewer' = 'owner';
let tenant = '', user = '';
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, requireCtx: async () => ({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role, plan: 'pro' }, role, workspaces: [] }) };
});

const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');

describe('campaign CSV download route', () => {
  let sql: postgres.Sql; let camp = '';
  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 });
    tenant = randomUUID(); user = `ex-${randomUUID().slice(0, 8)}`;
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${'EX ' + user})`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    const tpl = (await sql`insert into templates (tenant_id, name, language, category, status, body) values (${tenant}, 'ex_t', 'en', 'marketing', 'approved', 'hello there friend') returning id`)[0]!.id;
    camp = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, est_cost_paise) values (${tenant}, ${'=Evil, "name"/../x'}, ${tpl}, '{}', 'completed', 100) returning id`)[0]!.id;
    for (const [n, ph, st] of [['=HYPERLINK("http://evil")', '+919900000001', 'read'], ['@SUM(A1)', '+919900000002', 'sent'], ['Normal, Name', '+919900000003', 'failed']] as const)
      await sql`insert into campaign_recipients (tenant_id, campaign_id, phone_e164, name, state, reason, sent_at) values (${tenant}, ${camp}, ${ph}, ${n}, ${st}, ${st === 'failed' ? '-2+3' : null}, now())`;
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id = ${tenant}`; await sql`delete from tenants where id = ${tenant}`; await sql`delete from "user" where id = ${user}`; await sql.end();
  });
  const get = async (q = '', id = camp) => (await import('../src/app/(app)/campaigns/[id]/export/route')).GET(new Request(`http://x/campaigns/${id}/export${q}`), { params: Promise.resolve({ id }) });

  it('lets an owner and an admin download, and logs it', async () => {
    for (const r of ['owner', 'admin'] as const) { role = r; const res = await get(); expect(res.status, r).toBe(200); }
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'campaign.exported'`)[0]!.n)).toBe(2);
  });
  it('refuses an agent and a viewer (phone numbers are personal data), and does not log a download that did not happen', async () => {
    const before = Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'campaign.exported'`)[0]!.n);
    for (const r of ['agent', 'viewer'] as const) { role = r; const res = await get(); expect(res.status, r).toBe(403); expect((await res.json()).error).toMatch(/owner or an admin/); }
    expect(Number((await sql`select count(*)::int n from audit_log where tenant_id = ${tenant} and action = 'campaign.exported'`)[0]!.n)).toBe(before);
  });
  it('the file is a safe spreadsheet: formulas are text, phone numbers stay readable, odd characters are quoted, the filename is clean', async () => {
    role = 'owner'; const res = await get('?result=all');
    expect(res.headers.get('content-type')).toContain('text/csv'); expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Evil-name-x-all.csv"');
    const text = (await res.text()).replace(/^\uFEFF/, ''); const lines = text.split('\r\n');
    expect(lines[0]).toBe('Name,Phone,Result,Why,Sent at (IST)');
    expect(lines).toHaveLength(4);
    for (const l of lines.slice(1)) expect(/^[=+\-@]/.test(l), l).toBe(false);
    expect(text).toContain(`'=HYPERLINK(""http://evil"")`); expect(text).toContain(`'@SUM(A1)`); expect(text).toContain(`"Normal, Name"`);
    expect(text).toContain(',+919900000001,'); expect(text).not.toContain(`'+919900000001`);
    expect(text).toContain(`'-2+3`);
  });
  it('only the chosen result is downloaded, a made-up filter falls back to everyone, and a campaign from elsewhere is a 404', async () => {
    role = 'owner';
    const only = (await (await get('?result=failed')).text()).replace(/^\uFEFF/, '').split('\r\n'); expect(only).toHaveLength(2); expect(only[1]).toContain('Normal, Name');
    expect((await (await get('?result=bogus')).text()).split('\r\n')).toHaveLength(4);
    const res = await get('', randomUUID()); expect(res.status).toBe(404);
    expect((await get('', 'not-a-uuid')).status).toBe(404);
  });
});

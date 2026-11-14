import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for tests');

describe('campaign report (real database)', () => {
  const tag = randomUUID().slice(0, 8);
  const T1 = randomUUID(), T2 = randomUUID(), U = `rp-${tag}`;
  let sql: postgres.Sql; let rep: typeof import('@/lib/core/campaign-report');
  let camp = '', campOther = '';
  const ctx = (tenant: string) => ({ user: { id: U, name: 'O', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role: 'owner' as const, plan: 'pro' }, role: 'owner' as const });

  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 });
    rep = await import('@/lib/core/campaign-report');
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${U}, 'u', ${U + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${T1}, ${'RP one ' + tag}), (${T2}, ${'RP two ' + tag})`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${T1}, ${U}, 'owner'), (${T2}, ${U}, 'owner')`;
    const tpl1 = (await sql`insert into templates (tenant_id, name, language, category, status, body) values (${T1}, 'rp_t', 'en', 'marketing', 'approved', 'hello there friend') returning id`)[0]!.id;
    const tpl2 = (await sql`insert into templates (tenant_id, name, language, category, status, body) values (${T2}, 'rp_t2', 'en', 'marketing', 'approved', 'hello there friend') returning id`)[0]!.id;
    camp = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, est_cost_paise, started_at) values (${T1}, ${'Report, "test" =1+1'}, ${tpl1}, '{}', 'completed', 500, now()) returning id`)[0]!.id;
    campOther = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, est_cost_paise) values (${T2}, 'other', ${tpl2}, '{}', 'completed', 500) returning id`)[0]!.id;
    const rec = async (t: string, c: string, state: string, name: string, phone: string, reason: string | null = null, sent = true) =>
      (await sql`insert into campaign_recipients (tenant_id, campaign_id, phone_e164, name, state, reason, sent_at) values (${t}, ${c}, ${phone}, ${name}, ${state}, ${reason}, ${sent ? sql`now()` : null}) returning id`)[0]!.id as string;
    const p = (n: number) => `+9199000${String(n).padStart(5, '0')}`;
    const ids: string[] = [];
    ids.push(await rec(T1, camp, 'replied', 'Asha', p(1)), await rec(T1, camp, 'read', '=cmd|calc', p(2)), await rec(T1, camp, 'delivered', 'Dev', p(3)), await rec(T1, camp, 'sent', 'Eka', p(4)));
    await rec(T1, camp, 'failed', 'Fay', p(5), 'Not a WhatsApp number'); await rec(T1, camp, 'skipped', 'Gita', p(6), 'Opted out', false); await rec(T1, camp, 'skipped', 'Hari', p(7), 'No permission on record', false);
    await rec(T1, camp, 'queued', 'Ila', p(8), null, false);
    await rec(T2, campOther, 'read', 'Other Person', '+919900099999');
    // real WhatsApp messages exist for 3 of them: two marketing billable, one not billable
    const contact = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${T1}, '+919900088888', 'Conv', 'allowed') returning id`)[0]!.id;
    const conv = (await sql`insert into conversations (tenant_id, contact_id) values (${T1}, ${contact}) returning id`)[0]!.id;
    for (const [i, bill] of [[0, true], [1, true], [2, false]] as const)
      await sql`insert into messages (tenant_id, conversation_id, direction, kind, body, status, template_category, pricing_category, billable, campaign_recipient_id) values (${T1}, ${conv}, 'out', 'template', 'x', 'delivered', 'marketing', 'marketing', ${bill}, ${ids[i]!})`;
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id in (${T1}, ${T2})`;
    await sql`delete from tenants where id in (${T1}, ${T2})`;
    await sql`delete from "user" where id = ${U}`;
    await sql.end();
  });

  it('builds the funnel, outcomes and reasons from the stored people', async () => {
    const r = await rep.campaignReportFor(ctx(T1), camp);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.data.funnel.map((s) => s.count)).toEqual([8, 4, 3, 2, 1]);
    expect(r.data.outcomes.find((o) => o.label === 'Skipped')!.count).toBe(2);
    expect(r.data.outcomes.reduce((n, o) => n + o.count, 0)).toBe(8);
    expect(r.data.reasons).toEqual([{ reason: 'No permission on record', state: 'skipped', count: 1 }, { reason: 'Not a WhatsApp number', state: 'failed', count: 1 }, { reason: 'Opted out', state: 'skipped', count: 1 }]);
  });
  it('prices only the messages Meta marked billable, from real message records', async () => {
    const r = await rep.campaignReportFor(ctx(T1), camp); if (!r.ok) throw new Error(r.error);
    expect(r.data.billed.billableMessages).toBe(2);
    expect(r.data.billed.lines).toEqual([{ category: 'marketing', messages: 2, rateX100: 8631, amountPaise: 173 }]);
    expect(r.data.billed.totalPaise).toBe(204);
    expect(r.data.simulated).toBe(false);
  });
  it('says so when there are no real messages behind the numbers (test mode)', async () => {
    const r = await rep.campaignReportFor(ctx(T2), campOther); if (!r.ok) throw new Error(r.error);
    expect(r.data.simulated).toBe(true); expect(r.data.billed.billableMessages).toBe(0);
  });
  it('another workspace’s campaign is not found, and so are bad ids', async () => {
    for (const id of [campOther, randomUUID(), 'nope', "x'; drop table campaigns;--"]) { const r = await rep.campaignReportFor(ctx(T1), id); expect(r.ok, id).toBe(false); }
    expect((await rep.campaignRecipientsFor(ctx(T1), campOther, 'all', 1)).ok && (await rep.campaignRecipientsFor(ctx(T1), campOther, 'all', 1) as any).data.total).toBe(0);
    const ex = await rep.campaignExportRows(ctx(T1), campOther, 'all'); expect(ex.ok).toBe(false);
  });
  it('filters people by result, pages them, and orders the newest first', async () => {
    const all = await rep.campaignRecipientsFor(ctx(T1), camp, 'all', 1); if (!all.ok) throw new Error(all.error);
    expect(all.data.total).toBe(8);
    for (const [f, n] of [['replied', 1], ['read', 1], ['delivered', 1], ['sent', 1], ['failed', 1], ['skipped', 2], ['waiting', 1], ['capped', 0]] as const) {
      const r = await rep.campaignRecipientsFor(ctx(T1), camp, f, 1); expect(r.ok && r.data.total, f).toBe(n);
    }
    expect((await rep.campaignRecipientsFor(ctx(T1), camp, 'bogus' as never, 1)).ok).toBe(false);
    const p9 = await rep.campaignRecipientsFor(ctx(T1), camp, 'all', 9999); expect(p9.ok && p9.data.rows).toHaveLength(0);
  });
  it('exports the people for the CSV, with the filter applied', async () => {
    const ex = await rep.campaignExportRows(ctx(T1), camp, 'skipped'); if (!ex.ok) throw new Error(ex.error);
    expect(ex.data.rows.map((r) => r.name).sort()).toEqual(['Gita', 'Hari']); expect(ex.data.truncated).toBe(false);
  });
  it('cuts the export at its limit and says so, instead of silently dropping people', async () => {
    const cut = await rep.campaignExportRows(ctx(T1), camp, 'all', 3); if (!cut.ok) throw new Error(cut.error);
    expect(cut.data.rows).toHaveLength(3); expect(cut.data.truncated).toBe(true);
    const exact = await rep.campaignExportRows(ctx(T1), camp, 'all', 8); if (!exact.ok) throw new Error(exact.error);
    expect(exact.data.rows).toHaveLength(8); expect(exact.data.truncated).toBe(false);
  });
});

describe('campaign export file (CSV safety)', () => {
  it('neutralises spreadsheet formulas in names and campaign titles, and quotes commas and quotes', async () => {
    const { toCsv } = await import('@/lib/contacts/import');
    const { RECIPIENT_CSV_HEADER, recipientCsvRow } = await import('@lbc/shared/campaign-report');
    const out = toCsv([[...RECIPIENT_CSV_HEADER], recipientCsvRow({ name: '=cmd|calc', phone: '+91', state: 'read', reason: 'say "hi", ok', sentAt: null }), recipientCsvRow({ name: '@evil', phone: '+91', state: 'sent', reason: '-1+1', sentAt: null })]);
    const lines = out.split('\r\n');
    expect(lines[1]).toBe(`'=cmd|calc,'+91,Read,"say ""hi"", ok",`);
    expect(lines[2]!.startsWith(`'@evil,`)).toBe(true); expect(lines[2]).toContain(`'-1+1`);
    for (const l of lines.slice(1)) expect(/^[=+\-@]/.test(l)).toBe(false);
  });
});

describe('pricing not reported yet', () => {
  it('says how many real messages are still waiting for Meta to report their charge', async () => {
    const rep = await import('@/lib/core/campaign-report');
    const sqlc = postgres(ADMIN, { max: 1 });
    const t = randomUUID(), u = `rq-${randomUUID().slice(0, 8)}`;
    try {
      await sqlc`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${u}, 'u', ${u + '@example.com'}, true, now(), now())`;
      await sqlc`insert into tenants (id, name) values (${t}, ${'RQ ' + u})`; await sqlc`insert into tenant_members (tenant_id, user_id, role) values (${t}, ${u}, 'owner')`;
      const tpl = (await sqlc`insert into templates (tenant_id, name, language, category, status, body) values (${t}, 'rq_t', 'en', 'marketing', 'approved', 'hello there friend') returning id`)[0]!.id;
      const camp = (await sqlc`insert into campaigns (tenant_id, name, template_id, group_ids, status, est_cost_paise) values (${t}, 'c', ${tpl}, '{}', 'completed', 100) returning id`)[0]!.id;
      const contact = (await sqlc`insert into contacts (tenant_id, phone_e164, consent_status) values (${t}, '+919900077777', 'allowed') returning id`)[0]!.id;
      const conv = (await sqlc`insert into conversations (tenant_id, contact_id) values (${t}, ${contact}) returning id`)[0]!.id;
      for (const [state, status, billable] of [['delivered', 'delivered', null], ['sent', 'accepted', null], ['delivered', 'delivered', true], ['failed', 'failed', null]] as const) {
        const rid = (await sqlc`insert into campaign_recipients (tenant_id, campaign_id, phone_e164, state, sent_at) values (${t}, ${camp}, ${'+9199' + Math.floor(Math.random() * 1e8)}, ${state}, now()) returning id`)[0]!.id;
        await sqlc`insert into messages (tenant_id, conversation_id, direction, kind, body, status, template_category, pricing_category, billable, campaign_recipient_id) values (${t}, ${conv}, 'out', 'template', 'x', ${status}, 'marketing', ${billable === true ? 'marketing' : null}, ${billable}, ${rid})`;
      }
      const r = await rep.campaignReportFor({ user: { id: u, name: 'O', email: '' }, tenantId: t, workspace: { tenantId: t, name: 'x', role: 'owner', plan: 'pro' }, role: 'owner' }, camp);
      if (!r.ok) throw new Error(r.error);
      expect(r.data.billed.awaitingPricing).toBe(2);   // delivered + accepted, not the failed one, not the priced one
      expect(r.data.billed.billableMessages).toBe(1);
    } finally {
      await sqlc`delete from audit_log where tenant_id = ${t}`; await sqlc`delete from tenants where id = ${t}`; await sqlc`delete from "user" where id = ${u}`; await sqlc.end();
    }
  });
});

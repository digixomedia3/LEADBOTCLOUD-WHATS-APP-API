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
const APP = 'https://panel.example-company.in';
const PERSON = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const code = () => Array.from({ length: 12 }, () => letters[Math.floor(Math.random() * 62)]).join('');

describe('tracked links', () => {
  let sql: postgres.Sql; let tpl = '', camp = '', plainTpl = '';
  const people: { rid: string; code: string; contact: string }[] = [];
  beforeAll(async () => {
    process.env.APP_URL = APP;
    sql = postgres(ADMIN, { max: 2 });
    tenant = randomUUID(); user = `tl-${randomUUID().slice(0, 8)}`;
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${'TLW ' + user})`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    tpl = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'tl_tracked', 'en', 'marketing', 'approved', 'hello there friend', ${sql.json([{ type: 'url', text: 'Open', value: `${APP}/r/{{1}}` }])}) returning id`)[0]!.id;
    plainTpl = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'tl_plain', 'en', 'marketing', 'approved', 'hello there friend', ${sql.json([{ type: 'url', text: 'Shop', value: 'https://shop.example.com/{{1}}' }])}) returning id`)[0]!.id;
    camp = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, est_cost_paise, link_url) values (${tenant}, 'Tracked', ${tpl}, '{}', 'completed', 100, 'https://shop.example.com/offer?x=1') returning id`)[0]!.id;
    for (let i = 0; i < 4; i++) {
      const contact = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${tenant}, ${'+91990008' + String(1000 + i)}, ${'P' + i}, 'allowed') returning id`)[0]!.id;
      const rid = (await sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, sent_at) values (${tenant}, ${camp}, ${contact}, ${'+91990008' + String(1000 + i)}, ${'P' + i}, ${i === 3 ? 'failed' : 'delivered'}, now()) returning id`)[0]!.id;
      const c = code(); await sql`insert into tracked_links (code, tenant_id, campaign_id, campaign_recipient_id) values (${c}, ${tenant}, ${camp}, ${rid})`;
      people.push({ rid, code: c, contact });
    }
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id = ${tenant}`; await sql`delete from tenants where id = ${tenant}`; await sql`delete from "user" where id = ${user}`; await sql.end();
  });
  const clicks = async (c?: string) => Number((await (c ? sql`select count(*)::int n from link_clicks where code = ${c} and is_bot = false` : sql`select count(*)::int n from link_clicks where campaign_id = ${camp} and is_bot = false`))[0]!.n);
  const bots = async () => Number((await sql`select count(*)::int n from link_clicks where campaign_id = ${camp} and is_bot = true`)[0]!.n);
  const hit = async (c: string, o: { ua?: string | null; method?: string; ip?: string } = {}) => {
    const { GET, HEAD } = await import('../src/app/r/[code]/route');
    const headers = new Headers({ 'x-forwarded-for': o.ip ?? `10.0.0.${Math.floor(Math.random() * 250)}` }); if (o.ua !== null) headers.set('user-agent', o.ua ?? PERSON);
    return (o.method === 'HEAD' ? HEAD : GET)(new Request(`http://x/r/${c}`, { method: o.method ?? 'GET', headers }), { params: Promise.resolve({ code: c }) });
  };

  it('a person\'s click is recorded and they land on the campaign\'s page (and not somewhere else)', async () => {
    const r = await hit(people[0]!.code);
    expect(r.status).toBe(302); expect(r.headers.get('location')).toBe('https://shop.example.com/offer?x=1');
    expect(await clicks(people[0]!.code)).toBe(1);
  });
  it('the response is never cached, never leaks the page it came from, and is kept out of search engines', async () => {
    const r = await hit(people[0]!.code);
    expect(r.headers.get('cache-control')).toMatch(/no-store/); expect(r.headers.get('referrer-policy')).toBe('no-referrer'); expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
  });
  it('link previews, scanners, scripts and HEAD requests are sent on but never counted as people', async () => {
    const before = await clicks(); const b0 = await bots();
    for (const ua of ['WhatsApp/2.23.20.0 A', 'facebookexternalhit/1.1', 'curl/8.4.0 something', 'python-requests/2.31.0']) { const r = await hit(people[1]!.code, { ua }); expect(r.status, ua).toBe(302); }
    expect((await hit(people[1]!.code, { ua: null })).status).toBe(302);
    expect((await hit(people[1]!.code, { method: 'HEAD' })).status).toBe(302);
    expect(await clicks()).toBe(before); expect(await bots()).toBe(b0 + 6);
  });
  it('the same person clicking again is a second click but one person', async () => {
    await hit(people[2]!.code); await hit(people[2]!.code);
    expect(await clicks(people[2]!.code)).toBe(2);
    const { campaignReportFor } = await import('@/lib/core/campaign-report');
    const r = await campaignReportFor({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role: 'owner', plan: 'pro' }, role: 'owner' }, camp);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.clicks).toMatchObject({ destination: 'https://shop.example.com/offer?x=1', people: 2, botVisits: 6 });
    expect(r.data.clicks!.total).toBeGreaterThanOrEqual(r.data.clicks!.people + 1);
  });
  it('an unknown or malformed code is a plain 404 and records nothing', async () => {
    const before = await clicks();
    for (const c of [code(), 'short', 'a'.repeat(13), "x'; drop table x;--", '..%2f..%2fetc', '%00%00%00%00%00%00', '']) { const r = await hit(c || 'empty'); expect(r.status, c).toBe(404); expect(r.headers.get('location')).toBeNull(); }
    expect(await clicks()).toBe(before);
  });
  it('guessing is slowed down: one address that keeps trying wrong codes is told to wait', async () => {
    // A fresh address every run: the counts live in Redis for a minute, so fixed addresses would start the next run already blocked.
    const oct = () => Math.floor(Math.random() * 250) + 1; const ip = `203.2.${oct()}.${oct()}`, otherIp = `203.3.${oct()}.${oct()}`; let blocked = 0;
    for (let i = 0; i < 40; i++) if ((await hit(code(), { ip })).status === 429) blocked++;
    expect(blocked).toBeGreaterThan(0);
    expect((await hit(code(), { ip })).status).toBe(429);
    expect((await hit(people[0]!.code, { ip })).status).toBe(429);   // while blocked, even a right code waits
    expect((await hit(people[0]!.code, { ip: otherIp })).status).toBe(302);   // other people are not affected
  });
  it('a script cannot flood the click table: past the limit people are still sent on but not counted', async () => {
    const ip = `198.51.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`; const before = await clicks(people[0]!.code);
    for (let i = 0; i < 130; i++) expect((await hit(people[0]!.code, { ip })).status).toBe(302);
    expect((await clicks(people[0]!.code)) - before).toBeLessThanOrEqual(120);
  });
  it('a suspended workspace\'s links stop working, and come back when it does', async () => {
    const was = (await sql`select status from tenants where id = ${tenant}`)[0]!.status as string;
    await sql`update tenants set status = 'suspended' where id = ${tenant}`;
    try { const before = await clicks(); expect((await hit(people[0]!.code)).status).toBe(404); expect(await clicks()).toBe(before); }
    finally { await sql`update tenants set status = ${was} where id = ${tenant}`; }
    expect((await hit(people[0]!.code)).status).toBe(302);
  });
  it('the database itself refuses a bad destination', async () => {
    for (const bad of ['http://x.com', 'javascript:alert(1)', 'https://user@x.com/', 'https://x.com/a b', '//x.com']) await expect(sql`update campaigns set link_url = ${bad} where id = ${camp}`, bad).rejects.toThrow();
  });
});

describe('creating a campaign with a tracked link', () => {
  let sql: postgres.Sql; let tpl = '', plain = '', grp = '';
  beforeAll(async () => {
    process.env.APP_URL = APP;
    sql = postgres(ADMIN, { max: 2 });
    tenant = randomUUID(); user = `tc-${randomUUID().slice(0, 8)}`; role = 'owner';
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${'TLC ' + user})`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    tpl = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'tl_tracked', 'en', 'marketing', 'approved', 'hello there friend', ${sql.json([{ type: 'url', text: 'Open', value: `${APP}/r/{{1}}` }])}) returning id`)[0]!.id;
    plain = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'tl_plain', 'en', 'marketing', 'approved', 'hello there friend', '[]') returning id`)[0]!.id;
    grp = (await sql`insert into contact_groups (tenant_id, name) values (${tenant}, 'g') returning id`)[0]!.id;
    const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${tenant}, '+919900099999', 'P', 'allowed') returning id`)[0]!.id;
    await sql`insert into contact_group_members (tenant_id, group_id, contact_id) values (${tenant}, ${grp}, ${c})`;
  });
  afterAll(async () => { await sql`delete from audit_log where tenant_id = ${tenant}`; await sql`delete from tenants where id = ${tenant}`; await sql`delete from "user" where id = ${user}`; await sql.end(); });
  const make = async (templateId: string, linkUrl?: string) => {
    const { createCampaignFor } = await import('@/lib/core/campaigns');
    return createCampaignFor({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role: 'owner', plan: 'pro' }, role: 'owner' }, { name: 'Camp ' + Math.random().toString(36).slice(2, 7), templateId, groupIds: [grp], when: 'later', scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), varMap: [], linkUrl });
  };
  it('needs a destination when the template has a tracked button', async () => {
    const r = await make(tpl); expect(r.ok).toBe(false); expect(!r.ok && r.error).toMatch(/tracked website button/);
  });
  it('stores a good destination (cleaned up) on the campaign', async () => {
    const r = await make(tpl, '  https://Shop.Example.com/offer?utm=wa  '); expect(r.ok).toBe(true);
    if (r.ok) expect((await sql`select link_url from campaigns where id = ${r.data.id}`)[0]!.link_url).toBe('https://shop.example.com/offer?utm=wa');
  });
  it('refuses unsafe or silly destinations with a clear reason', async () => {
    for (const bad of ['http://shop.example.com', 'javascript:alert(1)', 'https://user:pw@shop.example.com', 'https://127.0.0.1/x', 'https://bit.ly/abc', `${APP}/r/abc`, 'not a url']) {
      const r = await make(tpl, bad); expect(r.ok, bad).toBe(false); expect(!r.ok && r.error.length > 10).toBe(true);
    }
  });
  it('a template without a tracked button refuses a link, so stray links cannot pile up', async () => {
    const r = await make(plain, 'https://shop.example.com'); expect(r.ok).toBe(false); expect(!r.ok && r.error).toMatch(/no tracked website button/);
    expect((await make(plain)).ok).toBe(true);
  });
});

describe('follow-up groups from a report', () => {
  let sql: postgres.Sql; let camp = '', noLink = '';
  const contacts: string[] = [];
  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 });
    tenant = randomUUID(); user = `rt-${randomUUID().slice(0, 8)}`; role = 'owner';
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name) values (${tenant}, ${'RTW ' + user})`; await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
    const tpl = (await sql`insert into templates (tenant_id, name, language, category, status, body, buttons) values (${tenant}, 'rt_t', 'en', 'marketing', 'approved', 'hello there friend', ${sql.json([{ type: 'url', text: 'Open', value: `${APP}/r/{{1}}` }])}) returning id`)[0]!.id;
    camp = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, est_cost_paise, link_url) values (${tenant}, 'Diwali push', ${tpl}, '{}', 'completed', 100, 'https://shop.example.com/offer') returning id`)[0]!.id;
    noLink = (await sql`insert into campaigns (tenant_id, name, template_id, group_ids, status, est_cost_paise) values (${tenant}, 'No link', ${tpl}, '{}', 'completed', 100) returning id`)[0]!.id;
    const states = ['read', 'read', 'delivered', 'delivered', 'replied', 'failed'] as const;
    for (let i = 0; i < states.length; i++) {
      const c = (await sql`insert into contacts (tenant_id, phone_e164, name, consent_status) values (${tenant}, ${'+91990007' + String(1000 + i)}, ${'C' + i}, 'allowed') returning id`)[0]!.id; contacts.push(c);
      const rid = (await sql`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state, sent_at) values (${tenant}, ${camp}, ${c}, ${'+91990007' + String(1000 + i)}, ${'C' + i}, ${states[i]!}, now()) returning id`)[0]!.id;
      const cd = code(); await sql`insert into tracked_links (code, tenant_id, campaign_id, campaign_recipient_id) values (${cd}, ${tenant}, ${camp}, ${rid})`;
      if (i === 0) await sql`insert into link_clicks (code, tenant_id, campaign_id, is_bot) values (${cd}, ${tenant}, ${camp}, false)`;
      if (i === 1) await sql`insert into link_clicks (code, tenant_id, campaign_id, is_bot) values (${cd}, ${tenant}, ${camp}, true)`;   // a robot, must not count as a click
    }
  });
  afterAll(async () => { await sql`delete from audit_log where tenant_id = ${tenant}`; await sql`delete from tenants where id = ${tenant}`; await sql`delete from "user" where id = ${user}`; await sql.end(); });
  const members = async (groupId: string) => {
    const { audienceWhere } = await import('@lbc/db');
    const { db } = await import('@/lib/tenant-db');
    const { sql: dsql } = await import('drizzle-orm');
    return db({ user: { id: user }, tenantId: tenant } as never, async (tx) => ((await tx.execute(dsql`select c.name from contacts c where ${audienceWhere(tenant, [{ id: groupId, kind: 'smart', filter: ((await tx.execute(dsql`select filter from contact_groups where id = ${groupId}::uuid`)) as unknown as { filter: never }[])[0]!.filter }])} order by c.name`)) as unknown as { name: string }[]).map((r) => r.name));
  };
  it('"clicked" means a real person clicked: the robot visit does not count', async () => {
    const { retargetFrom } = await import('../src/app/(app)/campaigns/[id]/actions');
    const r = await retargetFrom(camp, 'clicked'); expect(r.ok).toBe(true);
    if (r.ok) { expect(r.people).toBe(1); expect(await members(r.groupId)).toEqual(['C0']); expect(r.name).toBe('Retarget: Diwali push – clicked'); }
  });
  it('"did not click" is only people who actually received it and did not click, with robot visits ignored', async () => {
    const { retargetFrom } = await import('../src/app/(app)/campaigns/[id]/actions');
    const r = await retargetFrom(camp, 'not_clicked'); expect(r.ok).toBe(true);
    if (r.ok) expect(await members(r.groupId)).toEqual(['C1', 'C2', 'C3', 'C4']);   // C5 failed: never got the message, so is not "did not click"
  });
  it('the other follow-ups pick the right people', async () => {
    const { retargetFrom } = await import('../src/app/(app)/campaigns/[id]/actions');
    const want: Record<string, string[]> = { not_read: ['C2', 'C3'], read: ['C0', 'C1', 'C4'], replied: ['C4'], failed: ['C5'], not_replied: ['C0', 'C1', 'C2', 'C3'] };
    for (const [op, names] of Object.entries(want)) { const r = await retargetFrom(camp, op as never); expect(r.ok, op).toBe(true); if (r.ok) expect(await members(r.groupId), op).toEqual(names); }
  });
  it('doing the same thing twice makes a second group instead of failing', async () => {
    const { retargetFrom } = await import('../src/app/(app)/campaigns/[id]/actions');
    const a = await retargetFrom(camp, 'replied'), b = await retargetFrom(camp, 'replied');
    expect(a.ok && b.ok).toBe(true); if (a.ok && b.ok) { expect(b.name).toMatch(/ \(\d+\)$/); expect(b.name).not.toBe(a.name); expect(a.groupId).not.toBe(b.groupId); }
  });
  it('click follow-ups are refused for a campaign that had no tracked link', async () => {
    const { retargetFrom } = await import('../src/app/(app)/campaigns/[id]/actions');
    for (const op of ['clicked', 'not_clicked'] as const) { const r = await retargetFrom(noLink, op); expect(r.ok, op).toBe(false); expect(!r.ok && r.error).toMatch(/no tracked link/); }
  });
  it('only an owner or admin can create them, and made-up options or ids are refused', async () => {
    const { retargetFrom } = await import('../src/app/(app)/campaigns/[id]/actions');
    for (const r of ['agent', 'viewer'] as const) { role = r; const x = await retargetFrom(camp, 'replied'); expect(x.ok, r).toBe(false); }
    role = 'admin'; expect((await retargetFrom(camp, 'replied')).ok).toBe(true);
    role = 'owner';
    expect((await retargetFrom(camp, 'everyone' as never)).ok).toBe(false);
    expect((await retargetFrom('not-an-id', 'replied')).ok).toBe(false);
    expect((await retargetFrom(randomUUID(), 'replied')).ok).toBe(false);
  });
});

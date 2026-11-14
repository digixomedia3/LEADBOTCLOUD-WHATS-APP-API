import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDb, audienceWhere, ruleSql } from '../src';
import type { SegmentRule } from '@lbc/shared';

const src = readFileSync(new URL('./rls.test.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => re.exec(src)![1]!;
const admin = createDb(process.env.DATABASE_URL_ADMIN_TEST ?? pick(/process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/), { max: 2 });
const tag = randomUUID().slice(0, 8);
const T1 = randomUUID(), T2 = randomUUID();
const u = admin.client.unsafe;
const id: Record<string, string> = {};
let SRC1 = '', SRC2 = '', CAMP1 = '', CAMP2 = '', GROUP_A = '';

// Ten people with known facts. Names say what is true about each one.
const people: Record<string, { tags?: string[]; inboundDaysAgo?: number | null; addedDaysAgo?: number }> = {
  vip: { tags: ['vip', 'delhi'], inboundDaysAgo: 2, addedDaysAgo: 5 },
  plain: { tags: [], inboundDaysAgo: null, addedDaysAgo: 100 },
  old_chat: { tags: ['delhi'], inboundDaysAgo: 60, addedDaysAgo: 200 },
  lead_new: { tags: [], inboundDaysAgo: null, addedDaysAgo: 1 },
  lead_won: { tags: ['vip'], inboundDaysAgo: 10, addedDaysAgo: 40 },
  read_it: { tags: [], inboundDaysAgo: null, addedDaysAgo: 30 },
  only_delivered: { tags: [], inboundDaysAgo: null, addedDaysAgo: 30 },
  replied: { tags: [], inboundDaysAgo: 1, addedDaysAgo: 30 },
  failed: { tags: [], inboundDaysAgo: null, addedDaysAgo: 30 },
  other_ws: { tags: ['vip'], inboundDaysAgo: 1, addedDaysAgo: 1 },
};

beforeAll(async () => {
  await u(`insert into tenants (id, name) values ('${T1}', 'SEG one ${tag}'), ('${T2}', 'SEG two ${tag}')`);
  SRC1 = (await u(`insert into lead_sources (tenant_id, name, public_id) values ('${T1}', 'a', 'seg-${tag}-1') returning id`))[0]!.id;
  SRC2 = (await u(`insert into lead_sources (tenant_id, name, public_id) values ('${T2}', 'b', 'seg-${tag}-2') returning id`))[0]!.id;
  let n = 0;
  for (const [name, p] of Object.entries(people)) {
    const t = name === 'other_ws' ? T2 : T1;
    const tags = `ARRAY[${(p.tags ?? []).map((x) => `'${x}'`).join(',')}]::text[]`;
    const inb = p.inboundDaysAgo == null ? 'null' : `now() - interval '${p.inboundDaysAgo} days'`;
    id[name] = (await u(`insert into contacts (tenant_id, phone_e164, name, tags, last_inbound_at, created_at, consent_status) values ('${t}', '+9199${tag.replace(/\D/g, '0').slice(0, 4)}${String(++n).padStart(4, '0')}', '${name}', ${tags}, ${inb}, now() - interval '${p.addedDaysAgo} days', 'allowed') returning id`))[0]!.id;
  }
  await u(`insert into leads (tenant_id, source_id, contact_id, status) values ('${T1}', '${SRC1}', '${id.lead_new}', 'new'), ('${T1}', '${SRC1}', '${id.lead_won}', 'won'), ('${T2}', '${SRC2}', '${id.other_ws}', 'won')`);
  CAMP1 = (await u(`insert into campaigns (tenant_id, name, template_id, group_ids, status) values ('${T1}', 'c1', null, '{}', 'completed') returning id`).catch(async () => {
    const tpl = (await u(`insert into templates (tenant_id, name, language, category, status, body) values ('${T1}', 'seg_t', 'en', 'marketing', 'approved', 'hello there friend') returning id`))[0]!.id;
    return u(`insert into campaigns (tenant_id, name, template_id, group_ids, status) values ('${T1}', 'c1', '${tpl}', '{}', 'completed') returning id`);
  }))[0]!.id;
  const tpl2 = (await u(`insert into templates (tenant_id, name, language, category, status, body) values ('${T2}', 'seg_t2', 'en', 'marketing', 'approved', 'hello there friend') returning id`))[0]!.id;
  CAMP2 = (await u(`insert into campaigns (tenant_id, name, template_id, group_ids, status) values ('${T2}', 'c2', '${tpl2}', '{}', 'completed') returning id`))[0]!.id;
  const rec = (t: string, c: string, camp: string, who: string, state: string) => u(`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state) values ('${t}', '${camp}', '${c}', '+910', '${who}', '${state}')`);
  await rec(T1, id.read_it!, CAMP1, 'read_it', 'read'); await rec(T1, id.only_delivered!, CAMP1, 'only_delivered', 'delivered');
  await rec(T1, id.replied!, CAMP1, 'replied', 'replied'); await rec(T1, id.failed!, CAMP1, 'failed', 'failed'); await rec(T1, id.vip!, CAMP1, 'vip', 'skipped');
  await rec(T2, id.other_ws!, CAMP2, 'other_ws', 'read');
  GROUP_A = (await u(`insert into contact_groups (tenant_id, name, kind) values ('${T1}', 'fixed', 'static') returning id`))[0]!.id;
  await u(`insert into contact_group_members (tenant_id, group_id, contact_id) values ('${T1}', '${GROUP_A}', '${id.plain}'), ('${T1}', '${GROUP_A}', '${id.vip}')`);
});
afterAll(async () => {
  await u(`delete from audit_log where tenant_id in ('${T1}','${T2}')`);
  await u(`delete from tenants where id in ('${T1}','${T2}')`);
  await Promise.all([admin.client.end()]);
});

/** Who (by name) is in this audience, looking at one workspace only, the way the worker does. */
async function who(tenant: string, groups: { id: string; kind: string; filter: unknown }[]) {
  const r = (await admin.db.execute(sql`select c.name from contacts c where c.tenant_id = ${tenant}::uuid and ${audienceWhere(tenant, groups)} order by c.name`)) as unknown as { name: string }[];
  return r.map((x) => x.name);
}
const seg = (match: 'all' | 'any', ...rules: SegmentRule[]) => [{ id: randomUUID(), kind: 'smart', filter: { match, rules } }];

describe('segment rules pick exactly the right people', () => {
  it('tag: has / does not have', async () => {
    expect(await who(T1, seg('all', { type: 'tag', op: 'has', value: 'vip' }))).toEqual(['lead_won', 'vip']);
    expect(await who(T1, seg('all', { type: 'tag', op: 'not_has', value: 'vip' }))).toEqual(['failed', 'lead_new', 'old_chat', 'only_delivered', 'plain', 'read_it', 'replied']);
  });
  it('lead status: is / is not', async () => {
    expect(await who(T1, seg('all', { type: 'lead_status', op: 'is', values: ['won'] }))).toEqual(['lead_won']);
    expect(await who(T1, seg('all', { type: 'lead_status', op: 'is', values: ['new', 'won'] }))).toEqual(['lead_new', 'lead_won']);
    expect((await who(T1, seg('all', { type: 'lead_status', op: 'is_not', values: ['won', 'new'] }))).sort()).toEqual(['failed', 'old_chat', 'only_delivered', 'plain', 'read_it', 'replied', 'vip']);
  });
  it('lead source', async () => { expect(await who(T1, seg('all', { type: 'lead_source', op: 'is', sourceId: SRC1 }))).toEqual(['lead_new', 'lead_won']); });
  it('last message from them: within / not within / never', async () => {
    expect(await who(T1, seg('all', { type: 'last_inbound', op: 'within', days: 7 }))).toEqual(['replied', 'vip']);
    expect(await who(T1, seg('all', { type: 'last_inbound', op: 'within', days: 30 }))).toEqual(['lead_won', 'replied', 'vip']);
    expect(await who(T1, seg('all', { type: 'last_inbound', op: 'not_within', days: 30 }))).toEqual(['failed', 'lead_new', 'old_chat', 'only_delivered', 'plain', 'read_it']);
    expect(await who(T1, seg('all', { type: 'last_inbound', op: 'never' }))).toEqual(['failed', 'lead_new', 'only_delivered', 'plain', 'read_it']);
  });
  it('when added: within / before', async () => {
    expect(await who(T1, seg('all', { type: 'added', op: 'within', days: 7 }))).toEqual(['lead_new', 'vip']);
    expect(await who(T1, seg('all', { type: 'added', op: 'before', days: 150 }))).toEqual(['old_chat']);
  });
  it('bulk send outcomes: received / read / replied / not read / not replied / failed', async () => {
    const c = (op: 'received' | 'read' | 'replied' | 'not_read' | 'not_replied' | 'failed') => who(T1, seg('all', { type: 'campaign', op, campaignId: CAMP1 }));
    expect(await c('received')).toEqual(['only_delivered', 'read_it', 'replied']);
    expect(await c('read')).toEqual(['read_it', 'replied']);
    expect(await c('replied')).toEqual(['replied']);
    expect(await c('not_read')).toEqual(['only_delivered']);
    expect(await c('not_replied')).toEqual(['only_delivered', 'read_it']);
    expect(await c('failed')).toEqual(['failed']);
  });
  it('a person who was skipped (never sent to) counts as none of the outcomes', async () => {
    for (const op of ['received', 'read', 'replied', 'not_read', 'not_replied', 'failed'] as const) expect(await who(T1, seg('all', { type: 'campaign', op, campaignId: CAMP1 }))).not.toContain('vip');
  });
});

describe('combining rules and groups', () => {
  it('ALL rules must match; ANY rule is enough', async () => {
    const a = { type: 'tag', op: 'has', value: 'vip' } as const, b = { type: 'tag', op: 'has', value: 'delhi' } as const;
    expect(await who(T1, seg('all', a, b))).toEqual(['vip']);
    expect(await who(T1, seg('any', a, b))).toEqual(['lead_won', 'old_chat', 'vip']);
  });
  it('the classic retarget: got the bulk send and did not read it', async () => {
    expect(await who(T1, seg('all', { type: 'campaign', op: 'not_read', campaignId: CAMP1 }, { type: 'last_inbound', op: 'never' }))).toEqual(['only_delivered']);
  });
  it('a fixed group and a segment together give the union, each person once', async () => {
    const both = [{ id: GROUP_A, kind: 'static', filter: null }, ...seg('all', { type: 'tag', op: 'has', value: 'vip' })];
    expect(await who(T1, both)).toEqual(['lead_won', 'plain', 'vip']);
  });
  it('a fixed group alone still works as before', async () => { expect(await who(T1, [{ id: GROUP_A, kind: 'static', filter: null }])).toEqual(['plain', 'vip']); });
});

describe('a broken or hostile segment can never widen or leak an audience', () => {
  it('an unreadable stored filter selects nobody, not everybody', async () => {
    for (const bad of [null, {}, { match: 'all', rules: [] }, { match: 'all', rules: [{ type: 'drop_table' }] }, 'x', { match: 'any', rules: [{ type: 'tag', op: 'has' }] }]) {
      expect(await who(T1, [{ id: randomUUID(), kind: 'smart', filter: bad }])).toEqual([]);
    }
  });
  it('no groups at all selects nobody', async () => { expect(await who(T1, [])).toEqual([]); });
  it('rules that name ANOTHER workspace’s source or bulk send match nobody in this one', async () => {
    expect(await who(T1, seg('all', { type: 'lead_source', op: 'is', sourceId: SRC2 }))).toEqual([]);
    expect(await who(T1, seg('all', { type: 'campaign', op: 'read', campaignId: CAMP2 }))).toEqual([]);
    expect(await who(T2, seg('all', { type: 'campaign', op: 'read', campaignId: CAMP1 }))).toEqual([]);
  });
  it('another workspace’s person never appears, even when the rule fits them', async () => {
    expect(await who(T1, seg('all', { type: 'tag', op: 'has', value: 'vip' }))).not.toContain('other_ws');
    expect(await who(T2, seg('all', { type: 'tag', op: 'has', value: 'vip' }))).toEqual(['other_ws']);
  });
  it('a tag with quotes and SQL in it is just text', async () => {
    const evil = "x'); drop table contacts; --";
    expect(await who(T1, seg('all', { type: 'tag', op: 'has', value: evil }))).toEqual([]);
    expect(Number(((await admin.db.execute(sql`select count(*)::int n from contacts where tenant_id = ${T1}::uuid`)) as unknown as { n: number }[])[0]!.n)).toBe(9);
  });
  it('a group id that is not a UUID is ignored instead of reaching the query', async () => {
    expect(await who(T1, [{ id: "x'; drop table contacts;--", kind: 'static', filter: null }])).toEqual([]);
  });
  it('ruleSql exists for every rule shape (so a new rule cannot be forgotten)', () => {
    const shapes: SegmentRule[] = [{ type: 'tag', op: 'has', value: 'a' }, { type: 'lead_status', op: 'is', values: ['new'] }, { type: 'lead_source', op: 'is', sourceId: SRC1 }, { type: 'last_inbound', op: 'never' }, { type: 'added', op: 'within', days: 1 }, { type: 'campaign', op: 'read', campaignId: CAMP1 }];
    for (const s of shapes) expect(ruleSql(s)).toBeTruthy();
  });
});

describe('rows planted across workspaces are ignored (the worker bypasses row security, so the query itself must hold)', () => {
  // The database has no composite keys, so a buggy writer could leave a row that points at another workspace's person. These tests plant such rows on purpose.
  it('a bulk-send record filed under the other workspace does not put this workspace’s person in a segment', async () => {
    await u(`insert into campaign_recipients (tenant_id, campaign_id, contact_id, phone_e164, name, state) values ('${T2}', '${CAMP2}', '${id.plain}', '+910', 'planted', 'read')`);
    expect(await who(T1, seg('all', { type: 'campaign', op: 'read', campaignId: CAMP2 }))).toEqual([]);
    await u(`delete from campaign_recipients where name = 'planted'`);
  });
  it('a lead filed under the other workspace does not count for this workspace’s person', async () => {
    await u(`insert into leads (tenant_id, source_id, contact_id, status) values ('${T2}', '${SRC2}', '${id.plain}', 'won')`);
    expect(await who(T1, seg('all', { type: 'lead_status', op: 'is', values: ['won'] }))).toEqual(['lead_won']);
    expect(await who(T1, seg('all', { type: 'lead_source', op: 'is', sourceId: SRC2 }))).toEqual([]);
    expect(await who(T1, seg('all', { type: 'lead_status', op: 'is_not', values: ['won'] }))).toContain('plain');
    await u(`delete from leads where tenant_id = '${T2}' and contact_id = '${id.plain}'`);
  });
  it('a group membership filed under the other workspace does not add anyone to this workspace’s group', async () => {
    await u(`insert into contact_group_members (tenant_id, group_id, contact_id) values ('${T2}', '${GROUP_A}', '${id.read_it}')`);
    expect(await who(T1, [{ id: GROUP_A, kind: 'static', filter: null }])).toEqual(['plain', 'vip']);
    await u(`delete from contact_group_members where tenant_id = '${T2}'`);
  });
});

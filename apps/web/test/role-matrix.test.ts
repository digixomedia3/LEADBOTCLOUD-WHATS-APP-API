import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/**
 * Who may do what. The rule lives in each server action (assertRole), so a new action that forgets it would silently let a viewer or an agent do
 * owner work. This runs the real actions as each role and checks two things:
 *   1. a role below the minimum is refused with the plain "role cannot do this" message and NOTHING is written;
 *   2. a role at or above the minimum is NOT refused for its role (it may fail for other reasons, like a made-up id, which is fine here).
 * Inputs are deliberately empty or made-up so an allowed call cannot change anything.
 */
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
type Role = 'owner' | 'admin' | 'agent' | 'viewer';
let role: Role = 'owner';
let tenant = '', user = '';
vi.mock('@/lib/session', async () => {
  const t = await import('@/lib/tenant-db');
  return { ...t, requireCtx: async () => ({ user: { id: user, name: 'U', email: '' }, tenantId: tenant, workspace: { tenantId: tenant, name: 'x', role, plan: 'pro' }, role, workspaces: [] }) };
});
const rlsSrc = readFileSync(new URL('../../../packages/db/test/rls.test.ts', import.meta.url), 'utf8');
const ADMIN = process.env.DATABASE_URL_ADMIN_TEST ?? /process\.env\.DATABASE_URL_ADMIN_TEST \?\? '([^']+)'/.exec(rlsSrc)?.[1] ?? '';
if (!ADMIN) throw new Error('Could not find the admin database URL for tests');

const RANK: Record<Role, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 };
const ID = randomUUID();
const REFUSED = /role cannot|only the (workspace )?owner|only an? (owner|admin)|only the owner or an admin|cannot do this/i;

type Call = [string, 'agent' | 'admin' | 'owner', () => Promise<unknown>];
const calls = (): Call[] => {
  const C = () => import('../src/app/(app)/contacts/actions');
  const T = () => import('../src/app/(app)/templates/actions');
  const J = () => import('../src/app/(app)/journeys/actions');
  const L = () => import('../src/app/(app)/leads/actions');
  const R = () => import('../src/app/(app)/renewals/actions');
  const A = () => import('../src/app/(app)/automation/actions');
  const K = () => import('../src/app/(app)/connections/actions');
  const S = () => import('../src/app/(app)/settings/actions');
  const Y = () => import('../src/app/(app)/settings/api-keys-actions');
  const H = () => import('../src/app/(app)/chats/actions');
  return [
    ['contacts.addContact', 'agent', async () => (await C()).addContact({ phone: '', name: '', email: '', tags: [], source: 'Other', consent: false } as never)],
    ['contacts.importContacts', 'admin', async () => (await C()).importContacts({ rows: [], source: 'Other', consent: false, groupIds: [], updateExisting: false } as never)],
    ['contacts.createGroup', 'admin', async () => (await C()).createGroup('' as never)],
    ['contacts.renameGroup', 'admin', async () => (await C()).renameGroup(ID, '')],
    ['contacts.deleteGroup', 'admin', async () => (await C()).deleteGroup(ID)],
    ['contacts.bulkAction', 'admin', async () => (await C()).bulkAction({ ids: [], action: 'delete' } as never)],
    ['contacts.exportContacts', 'admin', async () => (await C()).exportContacts({})],
    ['templates.saveTemplate', 'admin', async () => (await T()).saveTemplate({} as never)],
    ['templates.submitTemplate', 'admin', async () => (await T()).submitTemplate(ID)],
    ['templates.deleteTemplate', 'admin', async () => (await T()).deleteTemplate(ID)],
    ['templates.duplicateTemplate', 'admin', async () => (await T()).duplicateTemplate(ID)],
    ['journeys.saveJourney', 'admin', async () => (await J()).saveJourney({} as never)],
    ['journeys.setJourneyStatus', 'admin', async () => (await J()).setJourneyStatus(ID, 'active' as never)],
    ['journeys.deleteJourney', 'admin', async () => (await J()).deleteJourney(ID)],
    ['journeys.stopAllRuns', 'admin', async () => (await J()).stopAllRuns(ID)],
    ['leads.createSource', 'admin', async () => (await L()).createSource({} as never)],
    ['leads.deleteSource', 'admin', async () => (await L()).deleteSource(ID)],
    ['leads.rotateSourceKey', 'admin', async () => (await L()).rotateSourceKey(ID)],
    ['leads.updateLead', 'agent', async () => (await L()).updateLead(ID, {} as never)],
    ['renewals.addRenewal', 'admin', async () => (await R()).addRenewal({} as never)],
    ['renewals.cancelRenewal', 'admin', async () => (await R()).cancelRenewal(ID)],
    ['automation.saveRule', 'admin', async () => (await A()).saveRule({} as never)],
    ['connections.disconnect', 'admin', async () => (await K()).disconnect(ID)],
    ['chats.deleteQuickReply', 'admin', async () => (await H()).deleteQuickReply(ID)],
    ['chats.setStatus', 'agent', async () => (await H()).setStatus(ID, 'resolved' as never)],
    ['settings.inviteMember', 'admin', async () => (await S()).inviteMember({ email: 'not-an-email', role: 'agent' })],
    ['settings.revokeInvite', 'admin', async () => (await S()).revokeInvite(ID)],
    ['settings.removeMember', 'admin', async () => (await S()).removeMember(ID)],
    ['settings.changeRole', 'owner', async () => (await S()).changeRole(ID, 'viewer')],
    ['settings.createApiKey', 'admin', async () => (await Y()).createApiKey({ name: 'k', scopes: ['contacts:read'], sendCapRupees: 0, expiresInDays: 1 })],
    ['settings.revokeApiKey', 'admin', async () => (await Y()).revokeApiKey(ID)],
  ];
};
const refused = (r: unknown) => {
  const o = r as { ok?: boolean; error?: string } | undefined;
  return !!o && (o.ok === false || o.ok === undefined) && typeof o.error === 'string' && REFUSED.test(o.error);
};

describe('role matrix: who may do what', () => {
  let sql: postgres.Sql; const tag = randomUUID().slice(0, 8);
  const count = async () => Number((await sql`select (select count(*) from contacts where tenant_id = ${tenant}) + (select count(*) from contact_groups where tenant_id = ${tenant}) + (select count(*) from templates where tenant_id = ${tenant}) + (select count(*) from journeys where tenant_id = ${tenant}) + (select count(*) from invitations where tenant_id = ${tenant}) + (select count(*) from api_keys where tenant_id = ${tenant}) as n`.then((r) => r[0]!.n)));
  beforeAll(async () => {
    sql = postgres(ADMIN, { max: 2 }); tenant = randomUUID(); user = `rm-${tag}`;
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at) values (${user}, 'u', ${user + '@example.com'}, true, now(), now())`;
    await sql`insert into tenants (id, name, plan_id) values (${tenant}, ${'RM ' + tag}, 'pro')`;
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenant}, ${user}, 'owner')`;
  });
  afterAll(async () => {
    await sql`delete from audit_log where tenant_id = ${tenant}`; await sql`delete from tenants where id = ${tenant}`; await sql`delete from "user" where id = ${user}`;
    const left = await sql`select count(*)::int n from tenants where id = ${tenant}`; await sql.end();
    if (Number(left[0]!.n) !== 0) throw new Error('role-matrix test left its workspace behind');
  });

  it('every action lists its minimum role, and the list is not empty', () => { expect(calls().length).toBeGreaterThanOrEqual(30); });

  for (const r of ['viewer', 'agent', 'admin', 'owner'] as Role[]) {
    it(`as ${r}: refused below the minimum, never refused at or above it`, async () => {
      role = r; const wrong: string[] = []; const before = await count();
      for (const [name, min, run] of calls()) {
        let out: unknown; let threw = '';
        try { out = await run(); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
        const shouldRefuse = RANK[r] < RANK[min];
        if (shouldRefuse && !refused(out)) wrong.push(`${name}: ${r} should be refused (needs ${min}) but got ${threw ? 'throw ' + threw.slice(0, 60) : JSON.stringify(out)?.slice(0, 80)}`);
        if (!shouldRefuse && refused(out)) wrong.push(`${name}: ${r} should be allowed (needs ${min}) but was refused as a role problem`);
      }
      expect(wrong, wrong.join('\n')).toEqual([]);
      // Nothing was written by any call: made-up ids and empty inputs cannot create rows, and a refused call must not either.
      const after = await count();
      if (after !== before) {
        // Say which call wrote, so a failure points at the action and not just at a number.
        const culprits: string[] = [];
        for (const [name, , run] of calls()) { const b = await count(); try { await run(); } catch { /* the role check is not the point here */ } if ((await count()) !== b) culprits.push(name); }
        expect(culprits, `as ${r}: these calls wrote rows`).toEqual([]);
      }
      expect(after).toBe(before);
    }, 60_000);
  }
});

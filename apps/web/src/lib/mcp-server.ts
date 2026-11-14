import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CONSENT_SOURCES } from '@lbc/shared';
import { hasScope, type ApiScope } from '@lbc/shared/api-keys';
import { cancelCampaignFor, createCampaignFor, previewAudienceFor, sendCampaignViaKey, campaignInput } from '@/lib/core/campaigns';
import { addContactFor, addToGroupFor, campaignStatusFor, createGroupFor, listApprovedTemplatesFor, listCampaignsFor, listGroupsFor, searchContactsFor } from '@/lib/core/contacts';
import type { ActorCtx } from '@/lib/tenant-db';

type Out = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): Out => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const bad = (error: string): Out => ({ content: [{ type: 'text', text: error }], isError: true });
const res = <T,>(r: { ok: true; data: T } | { ok: false; error: string }): Out => (r.ok ? ok(r.data) : bad(r.error));

/**
 * One MCP server per request, bound to the key that made it. Only the tools this key's permissions allow are even listed,
 * so an agent never sees (or tries) something it cannot do. A tool is checked again when called.
 */
export function buildServer(ctx: ActorCtx): McpServer {
  const scopes = ctx.via?.scopes ?? [];
  const server = new McpServer({ name: 'leadbotcloud', version: '1.0.0' }, {
    instructions:
      'Controls one LeadBotCloud WhatsApp workspace. Rules you must follow: (1) Only add a contact when the user has told you the person agreed to get WhatsApp messages and where; never invent consent. ' +
      '(2) Creating a bulk send does not send it. Before starting a send, call preview_audience, tell the user who will receive it and what it costs, and get a clear yes. ' +
      '(3) Customers who opted out are skipped automatically; do not try to work around that. (4) Report errors to the user in plain words.',
  });
  const allow = (s: ApiScope) => hasScope(scopes, s);
  const guarded = <A,>(s: ApiScope, fn: (a: A) => Promise<Out>) => async (a: A): Promise<Out> => (allow(s) ? fn(a) : bad(`This key does not have the "${s}" permission.`));

  if (allow('contacts:read')) {
    server.registerTool('whoami', { description: 'Shows which workspace this key controls, its permissions and its per-send money limit.', annotations: { readOnlyHint: true } },
      async () => ok({ workspace: ctx.workspace.name, plan: ctx.workspace.plan, permissions: scopes, perSendLimitRupees: (ctx.via?.sendCapPaise ?? 0) / 100 }));
    server.registerTool('search_contacts', {
      description: 'Find contacts by name, phone or email, or by tag or group. Returns at most 50. "permission" says whether the person agreed to messages, opted out, or has no record.',
      inputSchema: { query: z.string().max(100).optional(), tag: z.string().max(40).optional(), groupId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    }, guarded('contacts:read', async (a: { query?: string; tag?: string; groupId?: string; limit?: number }) => res(await searchContactsFor(ctx, { q: a.query, tag: a.tag, groupId: a.groupId, limit: a.limit }))));
    server.registerTool('list_groups', { description: 'Lists contact groups. kind "fixed" is a hand-made list; "segment" is an automatic list built from rules.', annotations: { readOnlyHint: true } },
      guarded('contacts:read', async () => res(await listGroupsFor(ctx))));
  }

  if (allow('contacts:write')) {
    server.registerTool('add_contact', {
      description: 'Adds ONE contact. Set agreedToMessages to true ONLY if the user told you this person agreed to get WhatsApp messages; say where in "source". Never guess this.',
      inputSchema: {
        phone: z.string().min(5).max(30).describe('Indian numbers can be written as 98765 43210 or +91 98765 43210'),
        name: z.string().max(120).optional(), email: z.string().email().optional(), tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        groupIds: z.array(z.string().uuid()).max(50).optional(),
        agreedToMessages: z.boolean().describe('True only if the person agreed to receive WhatsApp messages from this business.'),
        source: z.enum(CONSENT_SOURCES).describe('Where they agreed'),
      },
    }, guarded('contacts:write', async (a: { phone: string; name?: string; email?: string; tags?: string[]; groupIds?: string[]; agreedToMessages: boolean; source: (typeof CONSENT_SOURCES)[number] }) =>
      res(await addContactFor(ctx, { phone: a.phone, name: a.name, email: a.email, tags: a.tags ?? [], groupIds: a.groupIds ?? [], consent: a.agreedToMessages, source: a.source }))));
    server.registerTool('create_group', { description: 'Creates an empty fixed group.', inputSchema: { name: z.string().min(2).max(80) } },
      guarded('contacts:write', async (a: { name: string }) => res(await createGroupFor(ctx, a.name))));
    server.registerTool('add_contacts_to_group', { description: 'Adds existing contacts to a fixed group (not to a segment).', inputSchema: { groupId: z.string().uuid(), contactIds: z.array(z.string().uuid()).min(1).max(500) } },
      guarded('contacts:write', async (a: { groupId: string; contactIds: string[] }) => res(await addToGroupFor(ctx, a.groupId, a.contactIds))));
  }

  if (allow('templates:read')) {
    server.registerTool('list_message_formats', { description: 'Lists APPROVED message formats you can send, with how many blanks each has and whether it needs an offer code or end time.', annotations: { readOnlyHint: true } },
      guarded('templates:read', async () => res(await listApprovedTemplatesFor(ctx))));
  }

  if (allow('campaigns:read')) {
    server.registerTool('list_campaigns', { description: 'Lists recent bulk sends and their status.', inputSchema: { limit: z.number().int().min(1).max(50).optional() }, annotations: { readOnlyHint: true } },
      guarded('campaigns:read', async (a: { limit?: number }) => res(await listCampaignsFor(ctx, a.limit ?? 20))));
    server.registerTool('get_campaign', { description: 'Status and results (sent, delivered, read, replied, failed) of one bulk send.', inputSchema: { campaignId: z.string().uuid() }, annotations: { readOnlyHint: true } },
      guarded('campaigns:read', async (a: { campaignId: string }) => res(await campaignStatusFor(ctx, a.campaignId))));
    server.registerTool('preview_audience', {
      description: 'Shows how many people a bulk send would reach and the estimated cost, WITHOUT creating or sending anything. Always do this and show the user before starting a send.',
      inputSchema: { groupIds: z.array(z.string().uuid()).min(1).max(50), category: z.enum(['marketing', 'utility']).describe('The category of the message format you plan to use') },
      annotations: { readOnlyHint: true },
    }, guarded('campaigns:read', async (a: { groupIds: string[]; category: 'marketing' | 'utility' }) => {
      const p = await previewAudienceFor(ctx, a.groupIds, a.category);
      return ok({ peopleInGroups: p.total, willReceive: p.sendable, skippedOptedOut: p.optedOut, skippedNoPermissionRecord: p.noRecord, estimatedCost: p.cost.totalLabel });
    }));
  }

  if (allow('campaigns:write')) {
    server.registerTool('create_campaign', {
      description: 'Creates a bulk send as a draft (when "now") or schedules it (when "later"). It does NOT send anything. Fill every blank of the message format in varMap ("@name" = customer first name).',
      inputSchema: {
        name: z.string().min(2).max(120), templateId: z.string().uuid(), groupIds: z.array(z.string().uuid()).min(1).max(50), when: z.enum(['now', 'later']),
        scheduledAt: z.string().optional().describe('ISO time, at least 5 minutes ahead, when "later"'), varMap: z.array(z.string().min(1).max(200)).max(20).optional(),
        spendCapRupees: z.number().min(0).optional(), offerCode: z.string().optional(), offerEndsAt: z.string().optional(),
      },
    }, guarded('campaigns:write', async (a: z.input<typeof campaignInput>) => res(await createCampaignFor(ctx, a))));
    server.registerTool('cancel_campaign', { description: 'Cancels a bulk send that has not started.', inputSchema: { campaignId: z.string().uuid() }, annotations: { destructiveHint: true } },
      guarded('campaigns:write', async (a: { campaignId: string }) => res(await cancelCampaignFor(ctx, a.campaignId))));
  }

  if (allow('campaigns:send')) {
    server.registerTool('start_campaign', {
      description: 'STARTS SENDING a bulk send to real customers and spends money. Only call after the user has seen the audience and cost and clearly said yes. Only works for campaigns created with this same key and within its money limits.',
      inputSchema: { campaignId: z.string().uuid(), userConfirmed: z.literal(true).describe('Must be true: the user has just approved this exact send.') },
      annotations: { destructiveHint: true, openWorldHint: true },
    }, guarded('campaigns:send', async (a: { campaignId: string }) => res(await sendCampaignViaKey(ctx, a.campaignId))));
  }
  return server;
}

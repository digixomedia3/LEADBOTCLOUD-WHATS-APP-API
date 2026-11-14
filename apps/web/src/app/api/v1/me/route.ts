import { okJson, route } from '@/lib/api-route';

/** Who is this key and what may it do. Agents call this first. */
export const GET = route('contacts:read', async (ctx) => okJson({ workspace: ctx.workspace.name, plan: ctx.workspace.plan, key: ctx.via?.prefix, scopes: ctx.via?.scopes, perSendLimitRupees: (ctx.via?.sendCapPaise ?? 0) / 100 }));

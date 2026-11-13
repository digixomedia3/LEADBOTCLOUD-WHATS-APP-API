'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { automationRules, contacts, contactConsentEvents, conversations, messages, quickReplies, tenantMembers, user } from '@lbc/db';
import { Forbidden, assertRole, db, requireCtx, type Ctx } from '@/lib/session';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

async function guard(min: 'agent' | 'admin' = 'agent'): Promise<{ ctx: Ctx } | { error: string }> {
  const ctx = await requireCtx();
  try { assertRole(ctx, min); } catch (e) {
    if (e instanceof Forbidden) return { error: 'Your role cannot do this.' };
    throw e;
  }
  return { ctx };
}

const STOP_WORDS = /^\s*(stop|unsubscribe|band karo|बंद करो|रोको)\s*[.!]?\s*$/i;
const HOUR = 3_600_000;

export interface ConvRow { id: string; contactId: string; name: string | null; phone: string; status: string; assignedTo: string | null; unread: number; preview: string | null; lastAt: string; windowOpen: boolean; consent: string }
export interface MsgRow { id: string; direction: 'in' | 'out' | 'note'; body: string; status: string; at: string; by: string | null }
export interface TeamMember { userId: string; name: string }

export async function listConversations(filter: 'open' | 'mine' | 'unassigned' | 'resolved' = 'open'): Promise<ConvRow[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const where = filter === 'resolved' ? eq(conversations.status, 'resolved')
      : filter === 'mine' ? and(eq(conversations.status, 'open'), eq(conversations.assignedTo, ctx.user.id))
      : filter === 'unassigned' ? and(eq(conversations.status, 'open'), sql`${conversations.assignedTo} is null`)
      : eq(conversations.status, 'open');
    const rows = await tx.select({ c: conversations, name: contacts.name, phone: contacts.phoneE164, consent: contacts.consentStatus }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(where).orderBy(desc(conversations.lastMessageAt)).limit(200);
    const now = Date.now();
    return rows.map(({ c, name, phone, consent }) => ({ id: c.id, contactId: c.contactId, name, phone, status: c.status, assignedTo: c.assignedTo, unread: c.unread, preview: c.lastPreview, lastAt: c.lastMessageAt.toISOString(), windowOpen: !!c.windowExpiresAt && c.windowExpiresAt.getTime() > now, consent }));
  });
}

export async function openConversation(id: string): Promise<{ conv: ConvRow; messages: MsgRow[] } | null> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const [r] = await tx.select({ c: conversations, name: contacts.name, phone: contacts.phoneE164, consent: contacts.consentStatus }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(eq(conversations.id, id));
    if (!r) return null;
    await tx.update(conversations).set({ unread: 0 }).where(eq(conversations.id, id));
    const ms = await tx.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt)).limit(500);
    const c = r.c;
    return {
      conv: { id: c.id, contactId: c.contactId, name: r.name, phone: r.phone, status: c.status, assignedTo: c.assignedTo, unread: 0, preview: c.lastPreview, lastAt: c.lastMessageAt.toISOString(), windowOpen: !!c.windowExpiresAt && c.windowExpiresAt.getTime() > Date.now(), consent: r.consent },
      messages: ms.map((m) => ({ id: m.id, direction: m.direction as MsgRow['direction'], body: m.body, status: m.status, at: m.createdAt.toISOString(), by: m.senderUserId })),
    };
  });
}

export async function listTeam(): Promise<TeamMember[]> {
  const ctx = await requireCtx();
  return db(ctx, async (tx) => {
    const r = await tx.select({ userId: tenantMembers.userId, name: user.name }).from(tenantMembers).innerJoin(user, eq(user.id, tenantMembers.userId)).where(eq(tenantMembers.tenantId, ctx.tenantId));
    return r;
  });
}

export async function sendReply(conversationId: string, text: string): Promise<Result<{ id: string }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const body = text.trim();
  if (!body) return fail('Type a message.');
  if (body.length > 4096) return fail('Messages can be 4,096 characters at most.');
  return db(g.ctx, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!c) return fail('Conversation not found.');
    if (!c.windowExpiresAt || c.windowExpiresAt.getTime() < Date.now()) return fail('The 24-hour reply window has closed. Send an approved message format to start the conversation again.');
    const [ct] = await tx.select({ s: contacts.consentStatus }).from(contacts).where(eq(contacts.id, c.contactId));
    if (ct?.s === 'stopped') return fail('This customer opted out. You cannot message them.');
    const [m] = await tx.insert(messages).values({ tenantId: g.ctx.tenantId, conversationId, direction: 'out', body, status: 'sent', senderUserId: g.ctx.user.id }).returning({ id: messages.id });
    await tx.update(conversations).set({ lastPreview: body.slice(0, 120), lastMessageAt: new Date(), assignedTo: c.assignedTo ?? g.ctx.user.id }).where(eq(conversations.id, conversationId));
    revalidatePath('/chats');
    return { ok: true as const, data: { id: m!.id } };
  });
}

export async function addNote(conversationId: string, text: string): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const body = text.trim().slice(0, 2000);
  if (!body) return fail('Type a note.');
  return db(g.ctx, async (tx) => {
    const [c] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId));
    if (!c) return fail('Conversation not found.');
    await tx.insert(messages).values({ tenantId: g.ctx.tenantId, conversationId, direction: 'note', body, status: 'sent', senderUserId: g.ctx.user.id });
    return { ok: true as const, data: null };
  });
}

export async function assign(conversationId: string, userId: string | null): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    if (userId) {
      const [m] = await tx.select({ u: tenantMembers.userId }).from(tenantMembers).where(and(eq(tenantMembers.tenantId, g.ctx.tenantId), eq(tenantMembers.userId, userId)));
      if (!m) return fail('That person is not in this workspace.');
    }
    await tx.update(conversations).set({ assignedTo: userId }).where(eq(conversations.id, conversationId));
    revalidatePath('/chats');
    return { ok: true as const, data: null };
  });
}

export async function setStatus(conversationId: string, status: 'open' | 'resolved'): Promise<Result> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    await tx.update(conversations).set({ status }).where(eq(conversations.id, conversationId));
    revalidatePath('/chats');
    return { ok: true as const, data: null };
  });
}

/** Starts a conversation with a contact (no message sent; the window is closed until they reply or you send a template). */
export async function startConversation(contactId: string): Promise<Result<{ id: string }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => {
    const [ct] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId));
    if (!ct) return fail('Contact not found.');
    const [ex] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, contactId));
    if (ex) return { ok: true as const, data: { id: ex.id } };
    const [row] = await tx.insert(conversations).values({ tenantId: g.ctx.tenantId, contactId }).returning({ id: conversations.id });
    return { ok: true as const, data: { id: row!.id } };
  });
}

/**
 * TEST MODE: pretends the customer wrote back. In production this logic runs from the Meta webhook.
 * Handles STOP words (opt-out + consent record) and active auto-reply rules, exactly as the live path will.
 */
export async function simulateInbound(conversationId: string, text: string): Promise<Result<{ autoReplied: boolean; optedOut: boolean }>> {
  const g = await guard(); if ('error' in g) return fail(g.error);
  const body = text.trim().slice(0, 2000);
  if (!body) return fail('Type what the customer says.');
  return db(g.ctx, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!c) return fail('Conversation not found.');
    const now = new Date();
    await tx.insert(messages).values({ tenantId: g.ctx.tenantId, conversationId, direction: 'in', body, status: 'received' });
    await tx.update(conversations).set({ unread: sql`${conversations.unread} + 1`, lastPreview: body.slice(0, 120), lastMessageAt: now, windowExpiresAt: new Date(now.getTime() + 24 * HOUR), status: 'open' }).where(eq(conversations.id, conversationId));
    await tx.update(contacts).set({ lastInboundAt: now }).where(eq(contacts.id, c.contactId));
    let optedOut = false, autoReplied = false;
    if (STOP_WORDS.test(body)) {
      await tx.update(contacts).set({ consentStatus: 'stopped', optOutAt: now, optOutSource: 'customer_reply', updatedAt: now }).where(eq(contacts.id, c.contactId));
      await tx.insert(contactConsentEvents).values({ tenantId: g.ctx.tenantId, contactId: c.contactId, action: 'opt_out', source: 'customer_reply', note: `Customer wrote: ${body.slice(0, 40)}` });
      await tx.insert(messages).values({ tenantId: g.ctx.tenantId, conversationId, direction: 'out', body: 'You will no longer receive promotional messages from us. Reply START to subscribe again.', status: 'sent', kind: 'auto' });
      optedOut = true;
    } else {
      const rules = await tx.select().from(automationRules).where(eq(automationRules.active, true));
      const lower = body.toLowerCase();
      const hit = rules.find((r) => r.kind === 'keyword' && r.keywords.some((k) => k && lower.includes(k.toLowerCase())));
      if (hit) {
        await tx.insert(messages).values({ tenantId: g.ctx.tenantId, conversationId, direction: 'out', body: hit.reply, status: 'sent', kind: 'auto' });
        await tx.update(automationRules).set({ hits: sql`${automationRules.hits} + 1` }).where(eq(automationRules.id, hit.id));
        autoReplied = true;
      }
    }
    revalidatePath('/chats');
    return { ok: true as const, data: { autoReplied, optedOut } };
  });
}

export async function listQuickReplies() {
  const ctx = await requireCtx();
  return db(ctx, (tx) => tx.select({ id: quickReplies.id, shortcut: quickReplies.shortcut, body: quickReplies.body }).from(quickReplies).orderBy(quickReplies.shortcut));
}

const qr = z.object({ shortcut: z.string().trim().min(1).max(30).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores.'), body: z.string().trim().min(1).max(1000) });
export async function saveQuickReply(input: z.input<typeof qr>): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  const p = qr.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the fields.');
  return db(g.ctx, async (tx) => {
    const ex = await tx.select({ id: quickReplies.id }).from(quickReplies).where(eq(quickReplies.shortcut, p.data.shortcut));
    if (ex.length) return fail('That shortcut already exists.');
    await tx.insert(quickReplies).values({ tenantId: g.ctx.tenantId, ...p.data });
    return { ok: true as const, data: null };
  });
}
export async function deleteQuickReply(id: string): Promise<Result> {
  const g = await guard('admin'); if ('error' in g) return fail(g.error);
  return db(g.ctx, async (tx) => { await tx.delete(quickReplies).where(eq(quickReplies.id, id)); return { ok: true as const, data: null }; });
}

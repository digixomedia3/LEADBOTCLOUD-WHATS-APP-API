import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Better Auth tables. GLOBAL (no tenant_id, no RLS): they hold identities, never tenant data.
 * Application code must not query them outside the auth layer.
 */
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Conventions (spec B§3): uuid PKs, timestamptz everywhere, enums as text + CHECK.
 * Every tenant-owned table carries tenant_id and gets ENABLE + FORCE ROW LEVEL SECURITY
 * in the RLS migration. Better Auth tables (user/session/account/verification) are GLOBAL
 * and never hold tenant data; they arrive with the auth PR.
 */

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    gstin: text('gstin'),
    status: text('status').notNull().default('pending_meta'),
    planId: text('plan_id').notNull().default('free'),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    vertical: text('vertical'),
    verticalReviewStatus: text('vertical_review_status').notNull().default('none'),
    aupAcceptedAt: timestamp('aup_accepted_at', { withTimezone: true }),
    aupVersion: text('aup_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'tenants_status_chk',
      sql`${t.status} in ('pending_meta','onboarding','ready','suspended','offboarded')`,
    ),
    check('tenants_locale_chk', sql`${t.locale} in ('en','hi','bn')`),
    check(
      'tenants_vertical_review_chk',
      sql`${t.verticalReviewStatus} in ('none','flagged','approved','blocked')`,
    ),
  ],
);

export const tenantMembers = pgTable(
  'tenant_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Better Auth user ids are text.
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    index('tenant_members_user_idx').on(t.userId),
    check('tenant_members_role_chk', sql`${t.role} in ('owner','admin','agent','viewer')`),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email'),
    phone: text('phone'),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_uq').on(t.tokenHash),
    index('invitations_tenant_idx').on(t.tenantId),
    check('invitations_role_chk', sql`${t.role} in ('admin','agent','viewer')`),
    check('invitations_contact_chk', sql`${t.email} is not null or ${t.phone} is not null`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    actorUserId: text('actor_user_id'),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('audit_log_actor_chk', sql`${t.actorType} in ('user','system','meta_webhook','agent','super_admin')`),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    phoneE164: text('phone_e164').notNull(),
    name: text('name'),
    email: text('email'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    attributes: jsonb('attributes').notNull().default(sql`'{}'::jsonb`),
    /** allowed = customer agreed to messages; stopped = opted out (never messaged); unknown = no record. */
    consentStatus: text('consent_status').notNull().default('unknown'),
    consentSource: text('consent_source'),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    optOutAt: timestamp('opt_out_at', { withTimezone: true }),
    optOutSource: text('opt_out_source'),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('contacts_tenant_phone_uq').on(t.tenantId, t.phoneE164),
    index('contacts_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('contacts_tags_gin').using('gin', t.tags),
    check('contacts_consent_chk', sql`${t.consentStatus} in ('allowed','stopped','unknown')`),
  ],
);

export const contactGroups = pgTable(
  'contact_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** static = hand-picked or imported members; smart = a saved filter with a live count. */
    kind: text('kind').notNull().default('static'),
    filter: jsonb('filter'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('contact_groups_tenant_name_uq').on(t.tenantId, t.name),
    check('contact_groups_kind_chk', sql`${t.kind} in ('static','smart')`),
  ],
);

export const contactGroupMembers = pgTable(
  'contact_group_members',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').notNull().references(() => contactGroups.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.contactId] }), index('cgm_contact_idx').on(t.contactId)],
);

/** Append-only proof of permission (Meta opt-in rules and DPDP). */
export const contactConsentEvents = pgTable(
  'contact_consent_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    source: text('source').notNull(),
    actorUserId: text('actor_user_id'),
    note: text('note'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cce_contact_idx').on(t.contactId, t.occurredAt),
    check('cce_action_chk', sql`${t.action} in ('opt_in','opt_out','resume')`),
  ],
);

export type Role = 'owner' | 'admin' | 'agent' | 'viewer';

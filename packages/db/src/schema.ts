import { sql } from 'drizzle-orm';
import {
  bigserial,
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
    // Better Auth user ids are text. FK to the global user table is added in the auth PR.
    userId: text('user_id').notNull(),
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

export type Role = 'owner' | 'admin' | 'agent' | 'viewer';

import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
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
    quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(true),
    quietStartHour: smallint('quiet_start_hour').notNull().default(21),
    quietEndHour: smallint('quiet_end_hour').notNull().default(9),
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
    freqCapHoldUntil: timestamp('freq_cap_hold_until', { withTimezone: true }),
    reachability: text('reachability').notNull().default('unknown'),
    unreachableSince: timestamp('unreachable_since', { withTimezone: true }),
    lastMarketingSentAt: timestamp('last_marketing_sent_at', { withTimezone: true }),
    profileName: text('profile_name'),
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

/** Templates (WhatsApp message templates). Status follows Meta's lifecycle; until a number is connected, approval is simulated in test mode. */
export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    language: text('language').notNull().default('en'),
    category: text('category').notNull(),
    status: text('status').notNull().default('draft'),
    headerType: text('header_type').notNull().default('none'),
    headerText: text('header_text'),
    offer: jsonb('offer'),
    body: text('body').notNull(),
    footer: text('footer'),
    buttons: jsonb('buttons').notNull().default(sql`'[]'::jsonb`),
    samples: jsonb('samples').notNull().default(sql`'[]'::jsonb`),
    quality: text('quality').notNull().default('unknown'),
    rejectionReason: text('rejection_reason'),
    createdBy: text('created_by'),
    metaTemplateId: text('meta_template_id'),
    categoryCurrent: text('category_current'),
    categoryPending: text('category_pending'),
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    pauseCount: integer('pause_count').notNull().default(0),
    submitRequestedAt: timestamp('submit_requested_at', { withTimezone: true }),
    submitError: text('submit_error'),
    submitAttempts: integer('submit_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('templates_tenant_name_lang_uq').on(t.tenantId, t.name, t.language),
    check('templates_category_chk', sql`${t.category} in ('marketing','utility','authentication')`),
    check('templates_status_chk', sql`${t.status} in ('draft','pending','approved','rejected','paused','disabled','deleting')`),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    groupIds: uuid('group_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: text('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    repeat: text('repeat').notNull().default('none'),
    estCostPaise: integer('est_cost_paise').notNull().default(0),
    spendCapPaise: integer('spend_cap_paise'),
    counts: jsonb('counts').notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: text('created_by'),
    pauseReason: text('pause_reason'),
    sendPolicy: text('send_policy').notNull().default('mm_fallback'),
    apiKeyId: uuid('api_key_id'),
    apiSentAt: timestamp('api_sent_at', { withTimezone: true }),
    offerCode: text('offer_code'),
    /** Where the tracked website button sends people. Checked on creation; the redirect reads it from here, never from the link. */
    linkUrl: text('link_url'),
    /** Messages per minute for this campaign; null means as fast as possible. */
    sendPerMinute: integer('send_per_minute'),
    /** A/B test: the second template, its blanks, and the share of people (10 to 90) who get it. All three or none. */
    abTemplateId: uuid('ab_template_id'),
    abVarMap: jsonb('ab_var_map'),
    abPercentB: integer('ab_percent_b'),
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    varMap: jsonb('var_map').notNull().default(sql`'[]'::jsonb`),
    launchedAt: timestamp('launched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaigns_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('campaigns_status_chk', sql`${t.status} in ('draft','scheduled','running','completed','paused','cancelled')`),
    check('campaigns_repeat_chk', sql`${t.repeat} in ('none','daily','weekly','monthly')`),
  ],
);

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    phoneE164: text('phone_e164').notNull(),
    name: text('name'),
    state: text('state').notNull().default('queued'),
    reason: text('reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    messageId: uuid('message_id'),
    attempt: integer('attempt').notNull().default(0),
    lastErrorCode: integer('last_error_code'),
  },
  (t) => [
    index('cr_campaign_idx').on(t.campaignId, t.state),
    check('cr_state_chk', sql`${t.state} in ('queued','sent','delivered','read','replied','failed','skipped')`),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('open'),
    assignedTo: text('assigned_to'),
    unread: integer('unread').notNull().default(0),
    lastPreview: text('last_preview'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    /** WhatsApp lets you reply freely for 24 hours after the customer's last message. */
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }),
    phoneNumberId: text('phone_number_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_tenant_contact_uq').on(t.tenantId, t.contactId),
    index('conversations_tenant_last_idx').on(t.tenantId, t.lastMessageAt),
    check('conversations_status_chk', sql`${t.status} in ('open','resolved')`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    kind: text('kind').notNull().default('text'),
    body: text('body').notNull(),
    status: text('status').notNull().default('sent'),
    senderUserId: text('sender_user_id'),
    wamid: text('wamid'),
    clientRef: text('client_ref'),
    phoneNumberId: text('phone_number_id'),
    templateName: text('template_name'),
    templateLanguage: text('template_language'),
    templateCategory: text('template_category'),
    payload: jsonb('payload'),
    campaignRecipientId: uuid('campaign_recipient_id'),
    sendPath: text('send_path'),
    statusRank: integer('status_rank').notNull().default(-1),
    errorCode: integer('error_code'),
    errorDetail: jsonb('error_detail'),
    pricingCategory: text('pricing_category'),
    pricingType: text('pricing_type'),
    billable: boolean('billable'),
    attempts: integer('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conv_idx').on(t.conversationId, t.createdAt),
    check('messages_direction_chk', sql`${t.direction} in ('in','out','note')`),
  ],
);

export const quickReplies = pgTable(
  'quick_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    shortcut: text('shortcut').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('quick_replies_tenant_shortcut_uq').on(t.tenantId, t.shortcut)],
);

export const automationRules = pgTable(
  'automation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('keyword'),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    reply: text('reply').notNull(),
    active: boolean('active').notNull().default(true),
    hits: integer('hits').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('automation_kind_chk', sql`${t.kind} in ('keyword','welcome','away')`)],
);

/** A customer plan to renew (gym month, subscription, ISP plan). Reminders are Promotional messages. */
export const renewals = pgTable(
  'renewals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    planName: text('plan_name').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    dueOn: text('due_on').notNull(),
    status: text('status').notNull().default('active'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('renewals_tenant_due_idx').on(t.tenantId, t.dueOn),
    check('renewals_status_chk', sql`${t.status} in ('active','renewed','cancelled')`),
    check('renewals_amount_chk', sql`${t.amountPaise} >= 0`),
  ],
);

/* ------------------------------------------------------------------ Meta connection (spec 3.1) */

export const onboardingSessions = pgTable(
  'onboarding_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    path: text('path').notNull().default('standard'),
    esVersion: text('es_version'),
    sessionInfo: jsonb('session_info'),
    esEvent: text('es_event'),
    cancelStep: text('cancel_step'),
    esError: jsonb('es_error'),
    codeReceivedAt: timestamp('code_received_at', { withTimezone: true }),
    tokenExchangedAt: timestamp('token_exchanged_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('onboarding_tenant_idx').on(t.tenantId, t.createdAt), check('onboarding_path_chk', sql`${t.path} in ('standard','coexistence')`)],
);

/** One Messaging account (the old WABA) per tenant at MVP. business_token_enc is NOT readable by the web role (column privileges). */
export const metaAccounts = pgTable(
  'meta_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    businessId: text('business_id'),
    messagingAccountId: text('messaging_account_id').notNull(),
    businessTokenEnc: text('business_token_enc'),
    tokenScopes: jsonb('token_scopes'),
    tokenStatus: text('token_status').notNull().default('valid'),
    tokenCheckedAt: timestamp('token_checked_at', { withTimezone: true }),
    subscribedAppsOk: boolean('subscribed_apps_ok').notNull().default(false),
    mmApiStatus: text('mm_api_status'),
    disableMarketingOnCloudApi: boolean('disable_marketing_on_cloud_api'),
    paymentMethodStatus: text('payment_method_status').notNull().default('unknown'),
    healthState: text('health_state').notNull().default('ok'),
    restrictionInfo: jsonb('restriction_info'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meta_accounts_messaging_uq').on(t.messagingAccountId),
    uniqueIndex('meta_accounts_tenant_uq').on(t.tenantId),
    check('meta_accounts_token_chk', sql`${t.tokenStatus} in ('valid','invalid','revoked')`),
    check('meta_accounts_pay_chk', sql`${t.paymentMethodStatus} in ('unknown','self_attested','confirmed','failing')`),
    check('meta_accounts_health_chk', sql`${t.healthState} in ('ok','restricted','violation','disabled','scheduled_disable')`),
  ],
);

export const phoneNumbers = pgTable(
  'phone_numbers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    metaAccountId: uuid('meta_account_id').notNull().references(() => metaAccounts.id, { onDelete: 'cascade' }),
    phoneNumberId: text('phone_number_id').notNull(),
    displayPhoneNumber: text('display_phone_number'),
    verifiedName: text('verified_name'),
    nameStatus: text('name_status'),
    codeVerificationStatus: text('code_verification_status'),
    status: text('status'),
    platformType: text('platform_type'),
    accountMode: text('account_mode'),
    isOnBizApp: boolean('is_on_biz_app'),
    qualityRating: text('quality_rating'),
    messagingLimitTier: text('messaging_limit_tier'),
    throughputLevel: text('throughput_level'),
    sendRateLimitMps: integer('send_rate_limit_mps'),
    pinEnc: text('pin_enc'),
    registeredAt: timestamp('registered_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('phone_numbers_pnid_uq').on(t.phoneNumberId), index('phone_numbers_tenant_idx').on(t.tenantId)],
);

/** Raw, append-only. Meta keeps no history, so we persist first and process later. Written by the worker only; no tenant can read it (one POST can hold several tenants). */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    signatureOk: boolean('signature_ok').notNull(),
    wabaId: text('waba_id'),
    phoneNumberId: text('phone_number_id'),
    field: text('field'),
    tenantId: uuid('tenant_id'),
    dedupeKey: text('dedupe_key').notNull(),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processError: text('process_error'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [uniqueIndex('webhook_events_dedupe_uq').on(t.dedupeKey), index('webhook_events_unprocessed_idx').on(t.processedAt, t.id)],
);

export const messageStatusEvents = pgTable(
  'message_status_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    wamid: text('wamid').notNull(),
    status: text('status').notNull(),
    ts: timestamp('ts', { withTimezone: true }),
    raw: jsonb('raw'),
    webhookEventId: bigserial('webhook_event_id', { mode: 'number' }),
  },
  (t) => [uniqueIndex('mse_wamid_status_uq').on(t.wamid, t.status)],
);

export type Role = 'owner' | 'admin' | 'agent' | 'viewer';

/** API keys for agents and integrations. Only a hash of the key is stored. See migration 0026. */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  sendCapPaise: integer('send_cap_paise').notNull().default(50000),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});


/** Journeys: a short list of steps (wait, send a template, add a tag) that people walk through one at a time. */
export const journeys = pgTable('journeys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  trigger: jsonb('trigger').notNull().default(sql`'{"type":"manual"}'::jsonb`),
  steps: jsonb('steps').notNull().default(sql`'[]'::jsonb`),
  stopOnReply: boolean('stop_on_reply').notNull().default(true),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

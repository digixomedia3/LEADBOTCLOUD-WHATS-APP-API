CREATE TABLE IF NOT EXISTS "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'keyword' NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"reply" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_kind_chk" CHECK ("automation_rules"."kind" in ('keyword','welcome','away'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"phone_e164" text NOT NULL,
	"name" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "cr_state_chk" CHECK ("campaign_recipients"."state" in ('queued','sent','delivered','read','replied','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template_id" uuid,
	"group_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"repeat" text DEFAULT 'none' NOT NULL,
	"est_cost_paise" integer DEFAULT 0 NOT NULL,
	"spend_cap_paise" integer,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_status_chk" CHECK ("campaigns"."status" in ('draft','scheduled','running','completed','paused','cancelled')),
	CONSTRAINT "campaigns_repeat_chk" CHECK ("campaigns"."repeat" in ('none','daily','weekly','monthly'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"unread" integer DEFAULT 0 NOT NULL,
	"last_preview" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_status_chk" CHECK ("conversations"."status" in ('open','resolved'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"sender_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_direction_chk" CHECK ("messages"."direction" in ('in','out','note'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quick_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shortcut" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"plan_name" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"due_on" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paid_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewals_status_chk" CHECK ("renewals"."status" in ('active','renewed','cancelled')),
	CONSTRAINT "renewals_amount_chk" CHECK ("renewals"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"header_type" text DEFAULT 'none' NOT NULL,
	"header_text" text,
	"body" text NOT NULL,
	"footer" text,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"samples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality" text DEFAULT 'unknown' NOT NULL,
	"rejection_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_category_chk" CHECK ("templates"."category" in ('marketing','utility','authentication')),
	CONSTRAINT "templates_status_chk" CHECK ("templates"."status" in ('draft','pending','approved','rejected','paused'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewals" ADD CONSTRAINT "renewals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewals" ADD CONSTRAINT "renewals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cr_campaign_idx" ON "campaign_recipients" USING btree ("campaign_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_tenant_created_idx" ON "campaigns" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_tenant_contact_uq" ON "conversations" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_tenant_last_idx" ON "conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conv_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quick_replies_tenant_shortcut_uq" ON "quick_replies" USING btree ("tenant_id","shortcut");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renewals_tenant_due_idx" ON "renewals" USING btree ("tenant_id","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "templates_tenant_name_lang_uq" ON "templates" USING btree ("tenant_id","name","language");
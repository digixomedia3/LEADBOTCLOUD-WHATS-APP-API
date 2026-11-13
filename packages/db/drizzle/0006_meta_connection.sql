CREATE TABLE IF NOT EXISTS "message_status_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"wamid" text NOT NULL,
	"status" text NOT NULL,
	"ts" timestamp with time zone,
	"raw" jsonb,
	"webhook_event_id" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"business_id" text,
	"messaging_account_id" text NOT NULL,
	"business_token_enc" text,
	"token_scopes" jsonb,
	"token_status" text DEFAULT 'valid' NOT NULL,
	"token_checked_at" timestamp with time zone,
	"subscribed_apps_ok" boolean DEFAULT false NOT NULL,
	"mm_api_status" text,
	"disable_marketing_on_cloud_api" boolean,
	"payment_method_status" text DEFAULT 'unknown' NOT NULL,
	"health_state" text DEFAULT 'ok' NOT NULL,
	"restriction_info" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_accounts_token_chk" CHECK ("meta_accounts"."token_status" in ('valid','invalid','revoked')),
	CONSTRAINT "meta_accounts_pay_chk" CHECK ("meta_accounts"."payment_method_status" in ('unknown','self_attested','confirmed','failing')),
	CONSTRAINT "meta_accounts_health_chk" CHECK ("meta_accounts"."health_state" in ('ok','restricted','violation','disabled','scheduled_disable'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"path" text DEFAULT 'standard' NOT NULL,
	"es_version" text,
	"session_info" jsonb,
	"es_event" text,
	"cancel_step" text,
	"es_error" jsonb,
	"code_received_at" timestamp with time zone,
	"token_exchanged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_path_chk" CHECK ("onboarding_sessions"."path" in ('standard','coexistence'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meta_account_id" uuid NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text,
	"verified_name" text,
	"name_status" text,
	"code_verification_status" text,
	"status" text,
	"platform_type" text,
	"account_mode" text,
	"is_on_biz_app" boolean,
	"quality_rating" text,
	"messaging_limit_tier" text,
	"throughput_level" text,
	"send_rate_limit_mps" integer,
	"pin_enc" text,
	"registered_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_ok" boolean NOT NULL,
	"waba_id" text,
	"phone_number_id" text,
	"field" text,
	"tenant_id" uuid,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"process_error" text,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_accounts" ADD CONSTRAINT "meta_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_meta_account_id_meta_accounts_id_fk" FOREIGN KEY ("meta_account_id") REFERENCES "public"."meta_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mse_wamid_status_uq" ON "message_status_events" USING btree ("wamid","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meta_accounts_messaging_uq" ON "meta_accounts" USING btree ("messaging_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meta_accounts_tenant_uq" ON "meta_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_tenant_idx" ON "onboarding_sessions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "phone_numbers_pnid_uq" ON "phone_numbers" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_numbers_tenant_idx" ON "phone_numbers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_dedupe_uq" ON "webhook_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("processed_at","id");
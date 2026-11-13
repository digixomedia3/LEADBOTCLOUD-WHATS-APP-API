-- Delivery pipeline columns (spec 3.1, 4.5, 5.4, 5.5). Append-only migration; nothing existing is rewritten.

-- messages: Meta ids, idempotency key, status rank, error + pricing fields
ALTER TABLE public.messages
  ADD COLUMN wamid text,
  ADD COLUMN client_ref text,
  ADD COLUMN phone_number_id text,
  ADD COLUMN template_name text,
  ADD COLUMN template_language text,
  ADD COLUMN template_category text,
  ADD COLUMN payload jsonb,
  ADD COLUMN campaign_recipient_id uuid,
  ADD COLUMN send_path text,
  ADD COLUMN status_rank smallint NOT NULL DEFAULT -1,
  ADD COLUMN error_code integer,
  ADD COLUMN error_detail jsonb,
  ADD COLUMN pricing_category text,
  ADD COLUMN pricing_type text,
  ADD COLUMN billable boolean,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN read_at timestamptz,
  ADD COLUMN failed_at timestamptz;
CREATE UNIQUE INDEX messages_wamid_uq ON public.messages (wamid) WHERE wamid IS NOT NULL;
CREATE UNIQUE INDEX messages_client_ref_uq ON public.messages (client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX messages_outbox_idx ON public.messages (created_at) WHERE direction = 'out' AND status = 'queued';
CREATE INDEX messages_campaign_recipient_idx ON public.messages (campaign_recipient_id) WHERE campaign_recipient_id IS NOT NULL;

-- widen the status vocabulary to the lifecycle in the spec
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_status_chk;
ALTER TABLE public.messages ADD CONSTRAINT messages_status_chk CHECK (status IN
  ('queued','sending','send_unknown','accepted','held','paused','sent','delivered','read','played','failed','received'));

-- contacts: protection fields used by the send pre-checks
ALTER TABLE public.contacts
  ADD COLUMN freq_cap_hold_until timestamptz,
  ADD COLUMN reachability text NOT NULL DEFAULT 'unknown',
  ADD COLUMN unreachable_since timestamptz,
  ADD COLUMN last_marketing_sent_at timestamptz,
  ADD COLUMN profile_name text;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_reachability_chk CHECK (reachability IN ('ok','unreachable','unknown'));

-- campaign_recipients: capped (131049) and retry states, plus the link to the message
ALTER TABLE public.campaign_recipients
  ADD COLUMN message_id uuid,
  ADD COLUMN attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error_code integer;
ALTER TABLE public.campaign_recipients DROP CONSTRAINT IF EXISTS cr_state_chk;
ALTER TABLE public.campaign_recipients ADD CONSTRAINT cr_state_chk CHECK (state IN
  ('queued','sent','delivered','read','replied','failed','skipped','capped','retry_wait'));
CREATE UNIQUE INDEX cr_campaign_contact_uq ON public.campaign_recipients (campaign_id, contact_id) WHERE contact_id IS NOT NULL;

-- campaigns: send policy + pause reason (spec 4.6)
ALTER TABLE public.campaigns ADD COLUMN pause_reason text, ADD COLUMN send_policy text NOT NULL DEFAULT 'mm_fallback';
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_policy_chk CHECK (send_policy IN ('mm_fallback','mm_strict','cloud_api'));

-- templates: Meta's id and the CURRENT category (it can differ from the requested one) and a disabled state
ALTER TABLE public.templates
  ADD COLUMN meta_template_id text,
  ADD COLUMN category_current text,
  ADD COLUMN category_pending text,
  ADD COLUMN paused_until timestamptz,
  ADD COLUMN pause_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.templates DROP CONSTRAINT IF EXISTS templates_status_chk;
ALTER TABLE public.templates ADD CONSTRAINT templates_status_chk CHECK (status IN ('draft','pending','approved','rejected','paused','disabled'));

-- conversations: which number the thread belongs to (one per number + contact, spec 3.1)
ALTER TABLE public.conversations ADD COLUMN phone_number_id text;

-- phone_numbers: the send worker reads the throughput-derived rate
-- (columns already exist: throughput_level, send_rate_limit_mps)

-- webhook_events: worker role needs to write and mark processed (it bypasses RLS but needs table privileges)
GRANT SELECT, INSERT, UPDATE ON public.webhook_events TO worker;
GRANT USAGE, SELECT ON SEQUENCE public.webhook_events_id_seq TO worker;
GRANT SELECT, INSERT, UPDATE ON public.message_status_events TO worker;
GRANT USAGE, SELECT ON SEQUENCE public.message_status_events_id_seq TO worker;
GRANT SELECT, INSERT, UPDATE ON public.meta_accounts, public.phone_numbers, public.onboarding_sessions TO worker;

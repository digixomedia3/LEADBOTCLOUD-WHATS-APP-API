-- Lead scoring (P6). Append-only.
-- A workspace may change how many points each signal is worth. NULL means "use the defaults". The values are re-checked in code (every signal is a whole number
-- inside its limit); the database only guarantees the shape, so a bad write can never break the lead list.
ALTER TABLE public.tenants ADD COLUMN lead_score_weights jsonb;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_lead_score_weights_chk CHECK (lead_score_weights IS NULL OR jsonb_typeof(lead_score_weights) = 'object');
GRANT SELECT (lead_score_weights) ON public.tenants TO app, worker;
GRANT UPDATE (lead_score_weights) ON public.tenants TO app;

-- Finding a person's replies, reads and clicks must stay fast as a workspace grows.
CREATE INDEX IF NOT EXISTS messages_conv_dir_idx ON public.messages (conversation_id, direction, created_at);
CREATE INDEX IF NOT EXISTS campaign_recipients_contact_idx ON public.campaign_recipients (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS link_clicks_code_idx ON public.link_clicks (code) WHERE is_bot = false;

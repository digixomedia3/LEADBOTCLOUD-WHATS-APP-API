-- Limited-time offers + per-campaign offer code (P4). Append-only.
-- templates.offer: {"text": "Expiring offer!", "hasExpiration": true} for a limited-time-offer template, NULL otherwise.
-- campaigns.offer_code / offer_expires_at: what a campaign sends with a copy-code button or a countdown (Meta takes both at SEND time, per message).
ALTER TABLE public.templates ADD COLUMN offer jsonb;
ALTER TABLE public.templates ADD CONSTRAINT templates_offer_chk CHECK (offer IS NULL OR (jsonb_typeof(offer) = 'object' AND length(coalesce(offer->>'text','')) BETWEEN 1 AND 16 AND jsonb_typeof(offer->'hasExpiration') = 'boolean'));
ALTER TABLE public.campaigns ADD COLUMN offer_code text;
ALTER TABLE public.campaigns ADD COLUMN offer_expires_at timestamptz;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_offer_code_chk CHECK (offer_code IS NULL OR offer_code ~ '^[A-Za-z0-9_-]{1,15}$');

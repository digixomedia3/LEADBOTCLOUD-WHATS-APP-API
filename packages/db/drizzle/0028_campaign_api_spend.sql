-- Which API key started a bulk send, and when, so a key's spend can be limited per send and per day. Append-only.
ALTER TABLE public.campaigns ADD COLUMN api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL;
ALTER TABLE public.campaigns ADD COLUMN api_sent_at timestamptz;
CREATE INDEX campaigns_api_spend_idx ON public.campaigns (api_key_id, api_sent_at) WHERE api_key_id IS NOT NULL;

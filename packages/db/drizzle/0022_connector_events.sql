-- Connector events + page picker (P3). Append-only.

-- Raw signed webhooks from connected platforms (Shopify). Worker only, same contract as billing_events: verify, store with a dedupe key, enqueue, 200.
CREATE TABLE public.connector_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  signature_ok boolean NOT NULL,
  topic text,
  external_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  process_error text,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX connector_events_unprocessed_idx ON public.connector_events (id) WHERE processed_at IS NULL AND signature_ok;
ALTER TABLE public.connector_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.connector_events FROM app;
GRANT SELECT, INSERT, UPDATE ON public.connector_events TO worker;
GRANT USAGE, SELECT ON SEQUENCE public.connector_events_id_seq TO worker;

-- Reads a state WITHOUT using it up (the Facebook Page picker shows a list, then the owner chooses). Same ownership checks as consume.
CREATE OR REPLACE FUNCTION public.peek_oauth_state(p_hash text, p_provider text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
DECLARE r record;
BEGIN
  IF public.current_tenant_id() IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN RAISE EXCEPTION 'peek_oauth_state: no tenant context' USING ERRCODE = '42501'; END IF;
  SELECT verifier_enc, extra INTO r FROM public.oauth_states
   WHERE state_hash = p_hash AND provider = p_provider AND tenant_id = public.current_tenant_id() AND user_id = public.current_user_id() AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('verifier', r.verifier_enc, 'extra', r.extra);
END $$;
REVOKE ALL ON FUNCTION public.peek_oauth_state(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_oauth_state(text, text) TO app;

-- The worker polls Google Sheets connections and needs to record what it has already read.
GRANT UPDATE ON public.lead_sources TO worker;

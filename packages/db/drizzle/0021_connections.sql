-- OAuth connectors (P3). Append-only.
-- A connection is one authorised link to an outside platform (a Facebook Page, a Shopify store, a Google account). Tokens are encrypted by the app (AES-256-GCM)
-- before they reach the database. The web role can NEVER read them: it sees only the non-secret columns, and the worker (which needs them to sync) can.

CREATE TABLE public.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_id uuid REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  last_sync_at timestamptz,
  last_error text,
  connected_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connections_provider_chk CHECK (provider IN ('meta_lead_ads','shopify','google_sheets')),
  CONSTRAINT connections_status_chk CHECK (status IN ('active','needs_reauth')),
  -- One Facebook Page / Shopify store / Google account belongs to ONE workspace, so an incoming event can only ever be routed one way.
  CONSTRAINT connections_external_uq UNIQUE (provider, external_id)
);
CREATE INDEX connections_tenant_idx ON public.connections (tenant_id, created_at DESC);
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections FORCE ROW LEVEL SECURITY;
CREATE POLICY connections_select ON public.connections FOR SELECT TO app USING (tenant_id = public.current_tenant_id());
CREATE POLICY connections_cfg_update ON public.connections FOR UPDATE TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY connections_owner ON public.connections FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.connections FROM app;
GRANT SELECT (id, tenant_id, provider, external_id, label, status, token_expires_at, scopes, config, source_id, last_sync_at, last_error, connected_by, created_at, updated_at) ON public.connections TO app;
GRANT UPDATE (config, updated_at) ON public.connections TO app;
GRANT SELECT, UPDATE ON public.connections TO worker;

-- Short-lived, single-use proof that THIS browser session started THIS connection. The state itself is only stored hashed.
CREATE TABLE public.oauth_states (
  id bigserial PRIMARY KEY,
  state_hash text NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  provider text NOT NULL,
  verifier_enc text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_states FORCE ROW LEVEL SECURITY;
CREATE POLICY oauth_states_insert ON public.oauth_states FOR INSERT TO app WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = public.current_user_id());
CREATE POLICY oauth_states_owner ON public.oauth_states FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.oauth_states FROM app;
GRANT INSERT ON public.oauth_states TO app;
GRANT USAGE, SELECT ON SEQUENCE public.oauth_states_id_seq TO app;

-- The definer functions below run as "owner" and are bound by FORCE RLS, so owner needs a policy on lead_sources too.
CREATE POLICY lead_sources_owner ON public.lead_sources FOR ALL TO owner USING (true) WITH CHECK (true);

-- Consumes a state: it must belong to this tenant AND this signed-in user, be unexpired, and is deleted so it works exactly once.
CREATE OR REPLACE FUNCTION public.consume_oauth_state(p_hash text, p_provider text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record;
BEGIN
  IF public.current_tenant_id() IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN RAISE EXCEPTION 'consume_oauth_state: no tenant context' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.oauth_states WHERE expires_at < now() - interval '1 hour';
  DELETE FROM public.oauth_states WHERE state_hash = p_hash AND provider = p_provider AND tenant_id = public.current_tenant_id() AND user_id = public.current_user_id() AND expires_at > now()
    RETURNING verifier_enc, extra INTO r;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('verifier', r.verifier_enc, 'extra', r.extra);
END $$;
REVOKE ALL ON FUNCTION public.consume_oauth_state(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state(text, text) TO app;

-- Stores (or refreshes) a connection and makes the lead source that its leads will arrive under. Owner/admin only.
CREATE OR REPLACE FUNCTION public.store_connection(p_provider text, p_external text, p_label text, p_access_enc text, p_refresh_enc text, p_expires timestamptz, p_scopes text[], p_config jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_other uuid; v_id uuid; v_src uuid; v_existing uuid;
BEGIN
  IF v_tenant IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN RAISE EXCEPTION 'store_connection: no tenant context' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_tenant AND user_id = public.current_user_id() AND role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'store_connection: owner or admin only' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO v_other FROM public.connections WHERE provider = p_provider AND external_id = p_external;
  IF v_other IS NOT NULL AND v_other <> v_tenant THEN RAISE EXCEPTION 'connection_in_use' USING ERRCODE = 'P0001'; END IF;
  SELECT id, source_id INTO v_existing, v_src FROM public.connections WHERE provider = p_provider AND external_id = p_external AND tenant_id = v_tenant;
  IF v_existing IS NULL OR v_src IS NULL THEN
    INSERT INTO public.lead_sources (tenant_id, kind, name, public_id, secret_hash, consent_mode, default_tags)
      VALUES (v_tenant, p_provider, p_label, 'conn_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 18), NULL, 'none', ARRAY[p_provider]) RETURNING id INTO v_src;
  ELSE
    UPDATE public.lead_sources SET enabled = true, name = p_label, updated_at = now() WHERE id = v_src;
  END IF;
  INSERT INTO public.connections (tenant_id, provider, external_id, label, access_token_enc, refresh_token_enc, token_expires_at, scopes, config, source_id, connected_by)
    VALUES (v_tenant, p_provider, p_external, p_label, p_access_enc, p_refresh_enc, p_expires, coalesce(p_scopes, '{}'), coalesce(p_config, '{}'::jsonb), v_src, public.current_user_id())
  ON CONFLICT (provider, external_id) DO UPDATE SET label = EXCLUDED.label, access_token_enc = EXCLUDED.access_token_enc,
    refresh_token_enc = coalesce(EXCLUDED.refresh_token_enc, public.connections.refresh_token_enc), token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes,
    status = 'active', last_error = NULL, source_id = v_src, connected_by = EXCLUDED.connected_by, updated_at = now()
  RETURNING id INTO v_id;
  PERFORM public.write_audit('connection.connected', 'connection', v_id::text, jsonb_build_object('provider', p_provider, 'external', p_external));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.store_connection(text,text,text,text,text,timestamptz,text[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_connection(text,text,text,text,text,timestamptz,text[],jsonb) TO app;

-- Disconnect deletes the connection (freeing the page/store for another workspace) and switches its source off. Leads and contacts stay.
CREATE OR REPLACE FUNCTION public.disconnect_connection(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_src uuid; v_prov text;
BEGIN
  IF v_tenant IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN RAISE EXCEPTION 'disconnect_connection: no tenant context' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_tenant AND user_id = public.current_user_id() AND role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'disconnect_connection: owner or admin only' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.connections WHERE id = p_id AND tenant_id = v_tenant RETURNING source_id, provider INTO v_src, v_prov;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_src IS NOT NULL THEN UPDATE public.lead_sources SET enabled = false, updated_at = now() WHERE id = v_src AND tenant_id = v_tenant; END IF;
  PERFORM public.write_audit('connection.disconnected', 'connection', p_id::text, jsonb_build_object('provider', v_prov));
END $$;
REVOKE ALL ON FUNCTION public.disconnect_connection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disconnect_connection(uuid) TO app;

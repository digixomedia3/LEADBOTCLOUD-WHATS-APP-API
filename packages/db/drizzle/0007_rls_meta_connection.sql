-- RLS and column-level secrecy for the Meta connection tables (spec 3.3, AGENTS.md rules 1 and 7).

ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meta_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_status_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events FORCE ROW LEVEL SECURITY;

CREATE POLICY onboarding_all ON public.onboarding_sessions FOR ALL TO app
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY meta_accounts_select ON public.meta_accounts FOR SELECT TO app USING (tenant_id = public.current_tenant_id());
CREATE POLICY phone_numbers_select ON public.phone_numbers FOR SELECT TO app USING (tenant_id = public.current_tenant_id());
CREATE POLICY mse_select ON public.message_status_events FOR SELECT TO app USING (tenant_id = public.current_tenant_id());

-- The web role can never read a token or a PIN, and never writes these tables directly (it goes through store_meta_connection below).
REVOKE ALL ON public.meta_accounts, public.phone_numbers FROM app;
GRANT SELECT (id, tenant_id, business_id, messaging_account_id, token_scopes, token_status, token_checked_at, subscribed_apps_ok, mm_api_status,
              disable_marketing_on_cloud_api, payment_method_status, health_state, restriction_info, created_at, updated_at) ON public.meta_accounts TO app;
GRANT SELECT (id, tenant_id, meta_account_id, phone_number_id, display_phone_number, verified_name, name_status, code_verification_status, status,
              platform_type, account_mode, is_on_biz_app, quality_rating, messaging_limit_tier, throughput_level, send_rate_limit_mps,
              registered_at, last_synced_at, created_at) ON public.phone_numbers TO app;
REVOKE ALL ON public.message_status_events FROM app;
GRANT SELECT ON public.message_status_events TO app;

-- Raw webhook events: worker only. One POST can carry several tenants, so no tenant policy exists at all.
REVOKE ALL ON public.webhook_events FROM app;

-- The owner role runs the definer function below, and FORCE RLS binds it, so it needs narrow policies on exactly what it writes.
CREATE POLICY meta_accounts_owner ON public.meta_accounts FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY phone_numbers_owner ON public.phone_numbers FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY onboarding_owner ON public.onboarding_sessions FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY tenants_owner_upd ON public.tenants FOR UPDATE TO owner USING (true) WITH CHECK (true);

-- Stores a finished connection. The web server encrypts the token first (AES-256-GCM), so the database only ever sees ciphertext.
-- It pins the row to the caller's own tenant and refuses a WABA that already belongs to another tenant.
CREATE OR REPLACE FUNCTION public.store_meta_connection(
  p_business_id text, p_messaging_account_id text, p_token_enc text, p_scopes jsonb, p_phone_number_id text, p_display text,
  p_verified_name text, p_pin_enc text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_acc uuid;
  v_other uuid;
BEGIN
  IF v_tenant IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN
    RAISE EXCEPTION 'store_meta_connection: no tenant context' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_tenant AND user_id = public.current_user_id() AND role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'store_meta_connection: owner or admin only' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO v_other FROM public.meta_accounts WHERE messaging_account_id = p_messaging_account_id;
  IF v_other IS NOT NULL AND v_other <> v_tenant THEN
    RAISE EXCEPTION 'waba_in_use' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.meta_accounts (tenant_id, business_id, messaging_account_id, business_token_enc, token_scopes, token_status, token_checked_at)
    VALUES (v_tenant, p_business_id, p_messaging_account_id, p_token_enc, p_scopes, 'valid', now())
    ON CONFLICT (tenant_id) DO UPDATE SET business_id = EXCLUDED.business_id, messaging_account_id = EXCLUDED.messaging_account_id,
      business_token_enc = EXCLUDED.business_token_enc, token_scopes = EXCLUDED.token_scopes, token_status = 'valid', token_checked_at = now(), updated_at = now()
    RETURNING id INTO v_acc;
  INSERT INTO public.phone_numbers (tenant_id, meta_account_id, phone_number_id, display_phone_number, verified_name, pin_enc)
    VALUES (v_tenant, v_acc, p_phone_number_id, p_display, p_verified_name, p_pin_enc)
    ON CONFLICT (phone_number_id) DO UPDATE SET display_phone_number = EXCLUDED.display_phone_number, verified_name = EXCLUDED.verified_name
      WHERE public.phone_numbers.tenant_id = v_tenant;
  UPDATE public.tenants SET status = 'onboarding', updated_at = now() WHERE id = v_tenant AND status = 'pending_meta';
  PERFORM public.write_audit('meta.connected', 'meta_account', v_acc::text, jsonb_build_object('phone_number_id', p_phone_number_id));
  RETURN v_acc;
END $$;
REVOKE ALL ON FUNCTION public.store_meta_connection(text, text, text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_meta_connection(text, text, text, jsonb, text, text, text, text) TO app;

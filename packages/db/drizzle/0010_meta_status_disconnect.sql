-- Status updates and disconnect for the Meta connection. The web role cannot write meta_accounts / phone_numbers directly (0007), so
-- each change is a narrow SECURITY DEFINER function pinned to the caller's own tenant and checked for owner/admin. Append-only.

CREATE OR REPLACE FUNCTION public.update_meta_status(
  p_quality text, p_status text, p_tier text, p_name_status text, p_platform text, p_mode text, p_on_biz boolean, p_code_ver text,
  p_registered boolean, p_mm text, p_disable_mm boolean, p_subscribed boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN RAISE EXCEPTION 'update_meta_status: no tenant context' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_tenant AND user_id = public.current_user_id() AND role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'update_meta_status: owner or admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.meta_accounts SET mm_api_status = p_mm, disable_marketing_on_cloud_api = p_disable_mm, subscribed_apps_ok = p_subscribed, health_state = 'ok', updated_at = now() WHERE tenant_id = v_tenant;
  UPDATE public.phone_numbers SET quality_rating = p_quality, status = p_status, messaging_limit_tier = coalesce(messaging_limit_tier, p_tier), name_status = p_name_status,
    platform_type = p_platform, account_mode = p_mode, is_on_biz_app = p_on_biz, code_verification_status = p_code_ver,
    registered_at = CASE WHEN p_registered THEN coalesce(registered_at, now()) ELSE registered_at END, last_synced_at = now() WHERE tenant_id = v_tenant;
END $$;
REVOKE ALL ON FUNCTION public.update_meta_status(text,text,text,text,text,text,boolean,text,boolean,text,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_meta_status(text,text,text,text,text,text,boolean,text,boolean,text,boolean,boolean) TO app;

CREATE OR REPLACE FUNCTION public.disconnect_meta() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN RAISE EXCEPTION 'disconnect_meta: no tenant context' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_tenant AND user_id = public.current_user_id() AND role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'disconnect_meta: owner or admin only' USING ERRCODE = '42501';
  END IF;
  -- Sending stops at once: the token is dropped, running campaigns pause, queued messages fail with a clear reason on their next pass.
  UPDATE public.meta_accounts SET token_status = 'revoked', business_token_enc = 'revoked', updated_at = now() WHERE tenant_id = v_tenant;
  DELETE FROM public.phone_numbers WHERE tenant_id = v_tenant;
  UPDATE public.campaigns SET status = 'paused', pause_reason = 'disconnected' WHERE tenant_id = v_tenant AND status IN ('scheduled','running');
END $$;
REVOKE ALL ON FUNCTION public.disconnect_meta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disconnect_meta() TO app;

-- The owner role runs these definer functions; FORCE RLS binds it, so it needs policies on what it touches.
CREATE POLICY campaigns_owner_pause ON public.campaigns FOR UPDATE TO owner USING (true) WITH CHECK (true);

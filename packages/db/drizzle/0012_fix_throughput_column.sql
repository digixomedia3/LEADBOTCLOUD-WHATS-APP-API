-- Fix for 0010: Meta's `throughput.level` (STANDARD / HIGH) is messages per second, NOT the daily messaging-limit tier (TIER_1K ...).
-- update_meta_status() stored it in messaging_limit_tier, so the panel showed "STANDARD" as the daily limit. It now writes throughput_level and
-- leaves messaging_limit_tier alone (it is filled only from a value Meta actually reports as a tier). Also clears wrong values already stored.
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
  UPDATE public.phone_numbers SET quality_rating = p_quality, status = p_status, throughput_level = p_tier, name_status = p_name_status,
    platform_type = p_platform, account_mode = p_mode, is_on_biz_app = p_on_biz, code_verification_status = p_code_ver,
    registered_at = CASE WHEN p_registered THEN coalesce(registered_at, now()) ELSE registered_at END, last_synced_at = now() WHERE tenant_id = v_tenant;
END $$;

UPDATE public.phone_numbers SET messaging_limit_tier = NULL WHERE messaging_limit_tier IN ('STANDARD','HIGH','NOT_APPLICABLE');

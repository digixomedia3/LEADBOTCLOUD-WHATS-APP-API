-- Workspace states are pending_meta/onboarding/ready/suspended/offboarded; only the last two block an API key (same rule the sender uses).
CREATE OR REPLACE FUNCTION public.resolve_api_key(p_hash text)
RETURNS TABLE (key_id uuid, tenant_id uuid, tenant_name text, plan_id text, scopes text[], send_cap_paise integer, user_id text, user_name text, role text, prefix text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record;
BEGIN
  SELECT k.id, k.tenant_id, t.name AS tenant_name, t.plan_id, k.scopes, k.send_cap_paise, k.created_by, u.name AS user_name, m.role, k.prefix, k.last_used_at
    INTO r
    FROM public.api_keys k
    JOIN public.tenants t ON t.id = k.tenant_id AND t.status NOT IN ('suspended', 'offboarded')
    JOIN public.tenant_members m ON m.tenant_id = k.tenant_id AND m.user_id = k.created_by AND m.role IN ('owner', 'admin')
    JOIN public."user" u ON u.id = k.created_by
   WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now());
  IF NOT FOUND THEN RETURN; END IF;
  IF r.last_used_at IS NULL OR r.last_used_at < now() - interval '1 minute' THEN UPDATE public.api_keys SET last_used_at = now() WHERE id = r.id; END IF;
  RETURN QUERY SELECT r.id, r.tenant_id, r.tenant_name, r.plan_id, r.scopes, r.send_cap_paise, r.created_by, r.user_name, r.role, r.prefix;
END $$;

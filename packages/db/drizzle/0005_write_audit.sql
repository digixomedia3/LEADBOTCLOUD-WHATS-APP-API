-- Audit writes for the web app. The app role has no INSERT on audit_log (append-only, spec rule), so it writes
-- through this function, which pins the row to the caller's own tenant and user.

CREATE OR REPLACE FUNCTION public.write_audit(p_action text, p_entity text, p_entity_id text, p_after jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'write_audit: no tenant context' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audit_log (tenant_id, actor_user_id, actor_type, action, entity, entity_id, after)
  VALUES (public.current_tenant_id(), nullif(public.current_user_id(), ''), 'user', left(p_action, 80), left(p_entity, 80), left(p_entity_id, 80), p_after);
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_audit(text, text, text, jsonb) TO app;

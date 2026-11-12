-- RLS for contacts, groups and consent events, plus the signup function.
-- Append-only. Applied as the OWNER role.

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contact_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contact_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_group_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contact_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_consent_events FORCE ROW LEVEL SECURITY;

CREATE POLICY contacts_all ON public.contacts FOR ALL TO app
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY contact_groups_all ON public.contact_groups FOR ALL TO app
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY cgm_all ON public.contact_group_members FOR ALL TO app
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY cce_select ON public.contact_consent_events FOR SELECT TO app
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY cce_insert ON public.contact_consent_events FOR INSERT TO app
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Proof of consent is append-only for everyone.
REVOKE UPDATE, DELETE ON public.contact_consent_events FROM app, worker;

-- FORCE ROW LEVEL SECURITY also binds the table owner. The signup function below runs as the owner,
-- so give the owner narrow policies on exactly the three tables it writes. The owner role is never
-- used by the app or the worker; it only runs migrations and SECURITY DEFINER functions.
CREATE POLICY tenants_owner ON public.tenants FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY members_owner ON public.tenant_members FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY audit_owner ON public.audit_log FOR INSERT TO owner WITH CHECK (true);

-- Creates a workspace for a user in one atomic step. The caller must have set app.user_id to the same
-- user (the web server does this from the verified session), so one user cannot create a workspace for another.
CREATE OR REPLACE FUNCTION public.create_workspace(
  p_user_id text,
  p_name text,
  p_vertical text,
  p_review_status text,
  p_terms_version text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> coalesce(public.current_user_id(), '') THEN
    RAISE EXCEPTION 'create_workspace: caller does not match user' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'create_workspace: unknown user' USING ERRCODE = '42501';
  END IF;
  IF p_review_status NOT IN ('none', 'flagged') THEN
    RAISE EXCEPTION 'create_workspace: invalid review status' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(p_name)) < 2 OR length(p_name) > 100 THEN
    RAISE EXCEPTION 'create_workspace: invalid name' USING ERRCODE = '22023';
  END IF;
  -- Abuse guard: at most 5 workspaces owned per user.
  IF (SELECT count(*) FROM public.tenant_members WHERE user_id = p_user_id AND role = 'owner') >= 5 THEN
    RAISE EXCEPTION 'create_workspace: workspace limit reached' USING ERRCODE = '53400';
  END IF;

  INSERT INTO public.tenants (name, vertical, vertical_review_status, aup_accepted_at, aup_version)
  VALUES (btrim(p_name), p_vertical, p_review_status, now(), p_terms_version)
  RETURNING id INTO v_tenant;

  INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (v_tenant, p_user_id, 'owner');
  INSERT INTO public.audit_log (tenant_id, actor_user_id, actor_type, action, entity, entity_id, after)
  VALUES (v_tenant, p_user_id, 'user', 'workspace.created', 'tenant', v_tenant::text,
          jsonb_build_object('vertical', p_vertical, 'review', p_review_status, 'terms', p_terms_version));
  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text, text, text, text) TO app;

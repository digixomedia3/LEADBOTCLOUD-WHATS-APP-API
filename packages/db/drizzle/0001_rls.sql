-- RLS for tenant tables (spec B§3.3). Hand-written, append-only.
-- Context is set per transaction by packages/db withTenant()/withUser():
--   app.tenant_id  uuid of the active workspace ('' when none)
--   app.user_id    Better Auth user id of the caller ('' when none)

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

-- tenants: visible when active, or when the caller is a member (workspace switcher).
-- Creation and deletion happen only through the worker/admin role, never the app role.
CREATE POLICY tenants_select ON public.tenants FOR SELECT TO app
  USING (id = public.current_tenant_id()
         OR id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = public.current_user_id()));
CREATE POLICY tenants_update ON public.tenants FOR UPDATE TO app
  USING (id = public.current_tenant_id())
  WITH CHECK (id = public.current_tenant_id());

-- tenant_members: the active workspace's members, plus the caller's own rows across workspaces.
CREATE POLICY members_select ON public.tenant_members FOR SELECT TO app
  USING (tenant_id = public.current_tenant_id() OR user_id = public.current_user_id());
CREATE POLICY members_insert ON public.tenant_members FOR INSERT TO app
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY members_update ON public.tenant_members FOR UPDATE TO app
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY members_delete ON public.tenant_members FOR DELETE TO app
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY invitations_all ON public.invitations FOR ALL TO app
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- audit_log: tenants can read their own entries; only the worker role writes; nobody updates or deletes.
CREATE POLICY audit_select ON public.audit_log FOR SELECT TO app
  USING (tenant_id = public.current_tenant_id());

-- Privileges (default privileges granted broad DML; tighten here).
REVOKE INSERT, DELETE ON public.tenants FROM app;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM app;
REVOKE UPDATE, DELETE ON public.audit_log FROM worker;
GRANT EXECUTE ON FUNCTION public.current_tenant_id(), public.current_user_id() TO app, worker;

-- Self-serve workspace closure (P8). Append-only.
-- An owner can ask to close the workspace. It is not instant: there is a 30-day window to change their mind (and to export), then the worker erases
-- everything that is personal or confidential and keeps only what the law requires (the workspace's name, invoices, subscription and audit history).
-- The web role cannot write `tenants`, so the two actions below are narrow SECURITY DEFINER functions that check the caller is the OWNER of the current workspace.
ALTER TABLE public.tenants ADD COLUMN closure_requested_at timestamptz, ADD COLUMN closure_due_at timestamptz, ADD COLUMN closure_requested_by text, ADD COLUMN closed_at timestamptz;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_closure_chk CHECK ((closure_due_at IS NULL) = (closure_requested_at IS NULL) AND (closure_due_at IS NULL OR closure_due_at >= closure_requested_at));

CREATE OR REPLACE FUNCTION public.request_workspace_closure(p_confirm text) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t uuid := public.current_tenant_id(); u text := public.current_user_id(); v public.tenants%ROWTYPE; due timestamptz; sub public.subscriptions%ROWTYPE;
BEGIN
  IF t IS NULL OR u IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = t AND user_id = u AND role = 'owner') THEN RAISE EXCEPTION 'only the owner can close a workspace' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.tenants WHERE id = t FOR UPDATE;
  IF v.status = 'offboarded' THEN RAISE EXCEPTION 'this workspace is already closed' USING ERRCODE = '22023'; END IF;
  IF v.closure_requested_at IS NOT NULL THEN RETURN v.closure_due_at; END IF;
  IF lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(v.name)) THEN RAISE EXCEPTION 'type the workspace name exactly to confirm' USING ERRCODE = '22023'; END IF;
  SELECT * INTO sub FROM public.subscriptions WHERE tenant_id = t;
  IF FOUND AND sub.status IN ('active','authenticated','pending','halted') AND NOT sub.cancel_at_cycle_end THEN RAISE EXCEPTION 'cancel your plan first (Plan and billing), so you are not charged again' USING ERRCODE = '22023'; END IF;
  due := now() + interval '30 days';
  UPDATE public.tenants SET closure_requested_at = now(), closure_due_at = due, closure_requested_by = u, updated_at = now() WHERE id = t;
  INSERT INTO public.audit_log (tenant_id, actor_type, actor_user_id, action, entity, entity_id, after) VALUES (t, 'user', u, 'workspace.closure_requested', 'tenant', t::text, jsonb_build_object('dueAt', due));
  RETURN due;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_workspace_closure() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t uuid := public.current_tenant_id(); u text := public.current_user_id(); n int;
BEGIN
  IF t IS NULL OR u IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = t AND user_id = u AND role = 'owner') THEN RAISE EXCEPTION 'only the owner can do this' USING ERRCODE = '42501'; END IF;
  UPDATE public.tenants SET closure_requested_at = NULL, closure_due_at = NULL, closure_requested_by = NULL, updated_at = now() WHERE id = t AND closure_requested_at IS NOT NULL AND status <> 'offboarded';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN INSERT INTO public.audit_log (tenant_id, actor_type, actor_user_id, action, entity, entity_id, after) VALUES (t, 'user', u, 'workspace.closure_cancelled', 'tenant', t::text, '{}'::jsonb); END IF;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.request_workspace_closure(text), public.cancel_workspace_closure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_workspace_closure(text), public.cancel_workspace_closure() TO app;
-- The web role may READ the three new columns (they are not secret); the worker does the closing.
GRANT SELECT (closure_requested_at, closure_due_at, closed_at) ON public.tenants TO app;
GRANT UPDATE (closure_requested_at, closure_due_at, closure_requested_by, closed_at, status, suspended_reason) ON public.tenants TO worker;

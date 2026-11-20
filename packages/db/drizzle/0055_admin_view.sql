-- Read-only "view as customer" for platform staff. Append-only.
-- A staff member (with two-step sign-in on) states a reason, and for 30 minutes sees one workspace exactly as its owner would, but cannot change anything.
-- The browser holds only a random id. Every request asks the database whether that id is a live view that belongs to THIS signed-in staff member, so a copied
-- or guessed id grants nothing. Starting and ending a view are written to the workspace's own Activity log, with the reason, so customers can see it happened.
CREATE TABLE public.admin_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 300),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  CHECK (expires_at > started_at AND expires_at <= started_at + interval '30 minutes')
);
CREATE INDEX admin_views_admin_idx ON public.admin_views (admin_user_id, started_at DESC);
CREATE INDEX admin_views_tenant_idx ON public.admin_views (tenant_id, started_at DESC);
-- Nobody but the functions below may read or write it.
ALTER TABLE public.admin_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_views FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_views FROM PUBLIC, app, worker;
-- The functions below run as the owner role, so only it may touch the table (the same pattern as the other admin tables).
CREATE POLICY admin_views_owner ON public.admin_views FOR ALL TO owner USING (true) WITH CHECK (true);
GRANT ALL ON public.admin_views TO owner;

-- Staff must also have two-step sign-in on (the same rule as the rest of the panel), checked here and not only in the app.
CREATE OR REPLACE FUNCTION public.admin_view_start(p_tenant uuid, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v text; t record; r text := btrim(coalesce(p_reason, '')); new_id uuid; exp timestamptz := now() + interval '30 minutes';
BEGIN
  v := public.admin_guard();
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = v AND two_factor_enabled) THEN RAISE EXCEPTION 'platform admin only' USING ERRCODE = '42501'; END IF;
  IF char_length(r) < 5 THEN RAISE EXCEPTION 'give a reason of at least 5 characters' USING ERRCODE = '22023'; END IF;
  IF char_length(r) > 300 THEN RAISE EXCEPTION 'the reason is too long (300 characters at most)' USING ERRCODE = '22023'; END IF;
  SELECT id, name, status, closed_at INTO t FROM public.tenants WHERE id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF t.closed_at IS NOT NULL THEN RAISE EXCEPTION 'this workspace has been closed and its data erased' USING ERRCODE = '22023'; END IF;
  -- One live view at a time per staff member: starting another ends the old one, and the log shows both.
  UPDATE public.admin_views SET ended_at = now() WHERE admin_user_id = v AND ended_at IS NULL AND expires_at > now();
  INSERT INTO public.admin_views (admin_user_id, tenant_id, reason, expires_at) VALUES (v, p_tenant, r, exp) RETURNING id INTO new_id;
  PERFORM public.admin_log(p_tenant, 'admin.view_started', 'tenant', p_tenant::text, jsonb_build_object('reason', r, 'viewId', new_id, 'minutes', 30));
  RETURN jsonb_build_object('id', new_id, 'tenantId', p_tenant, 'tenantName', t.name, 'expiresAt', exp);
END $$;

-- Is this id a live view of this signed-in staff member? Returns the workspace to show, or nothing.
CREATE OR REPLACE FUNCTION public.admin_view_get(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', a.id, 'tenantId', t.id, 'tenantName', t.name, 'plan', t.plan_id, 'reason', a.reason, 'expiresAt', a.expires_at)
  FROM public.admin_views a
  JOIN public.tenants t ON t.id = a.tenant_id
  WHERE a.id = p_id AND a.admin_user_id = public.current_user_id() AND a.ended_at IS NULL AND a.expires_at > now() AND t.closed_at IS NULL
    AND EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id = a.admin_user_id)
    AND EXISTS (SELECT 1 FROM public."user" u WHERE u.id = a.admin_user_id AND u.two_factor_enabled)
$$;

CREATE OR REPLACE FUNCTION public.admin_view_end(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v text; a record;
BEGIN
  v := public.admin_guard();
  UPDATE public.admin_views SET ended_at = now() WHERE id = p_id AND admin_user_id = v AND ended_at IS NULL RETURNING tenant_id, started_at INTO a;
  IF NOT FOUND THEN RETURN jsonb_build_object('ended', false); END IF;
  PERFORM public.admin_log(a.tenant_id, 'admin.view_ended', 'tenant', a.tenant_id::text, jsonb_build_object('viewId', p_id, 'seconds', extract(epoch FROM now() - a.started_at)::int));
  RETURN jsonb_build_object('ended', true);
END $$;

-- Staff history of views, for the admin panel (who looked at which workspace, why, and for how long).
CREATE OR REPLACE FUNCTION public.admin_view_history(p_tenant uuid, p_limit int) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN coalesce((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('id', a.id, 'staff', u.email, 'reason', a.reason, 'startedAt', a.started_at, 'endedAt', a.ended_at, 'expiresAt', a.expires_at) x
    FROM public.admin_views a JOIN public."user" u ON u.id = a.admin_user_id
    WHERE a.tenant_id = p_tenant ORDER BY a.started_at DESC LIMIT least(greatest(coalesce(p_limit, 20), 1), 100)) q), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.admin_view_start(uuid, text), public.admin_view_get(uuid), public.admin_view_end(uuid), public.admin_view_history(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_view_start(uuid, text), public.admin_view_get(uuid), public.admin_view_end(uuid), public.admin_view_history(uuid, int) TO app;

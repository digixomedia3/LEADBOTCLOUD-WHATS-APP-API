-- Fix for 0045: the "cancel your plan first" check listed some live statuses and missed others (created, paused). Anything that is not finished
-- (cancelled, completed, expired) can still charge or become active, so closing is refused unless it is already set to end at the period's close.
-- Append-only: this replaces the function body only.
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
  IF FOUND AND sub.status NOT IN ('cancelled','completed','expired') AND NOT sub.cancel_at_cycle_end THEN RAISE EXCEPTION 'cancel your plan first (Plan and billing), so you are not charged again' USING ERRCODE = '22023'; END IF;
  due := now() + interval '30 days';
  UPDATE public.tenants SET closure_requested_at = now(), closure_due_at = due, closure_requested_by = u, updated_at = now() WHERE id = t;
  INSERT INTO public.audit_log (tenant_id, actor_type, actor_user_id, action, entity, entity_id, after) VALUES (t, 'user', u, 'workspace.closure_requested', 'tenant', t::text, jsonb_build_object('dueAt', due));
  RETURN due;
END $$;

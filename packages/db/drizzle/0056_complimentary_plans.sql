-- Complimentary plans for platform staff. Append-only.
-- Until now a staff plan change just overwrote tenants.plan_id: no end date, no reason a customer could see, and the next billing event could silently undo it.
-- A complimentary plan is now a recorded grant: a plan, an end date (1 to 365 days), a reason, and who gave it. It ends by itself, and it never replaces
-- something the customer pays for. One function, effective_plan(), decides what a workspace gets (the better of what it pays for and any live grant),
-- and every place that changes plan_id uses it, so billing events, expiry and staff actions cannot disagree.

ALTER TABLE public.tenants
  ADD COLUMN comp_plan text,
  ADD COLUMN comp_until timestamptz,
  ADD COLUMN comp_reason text,
  ADD COLUMN comp_granted_by text,
  ADD COLUMN comp_granted_at timestamptz;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_comp_chk CHECK (
  (comp_plan IS NULL AND comp_until IS NULL AND comp_reason IS NULL AND comp_granted_by IS NULL AND comp_granted_at IS NULL)
  OR (comp_plan IN ('starter','growth','pro') AND comp_until IS NOT NULL AND comp_granted_at IS NOT NULL AND comp_granted_by IS NOT NULL
      AND char_length(comp_reason) BETWEEN 5 AND 200 AND comp_until > comp_granted_at AND comp_until <= comp_granted_at + interval '366 days')
);
CREATE INDEX tenants_comp_until_idx ON public.tenants (comp_until) WHERE comp_plan IS NOT NULL;

CREATE OR REPLACE FUNCTION public.plan_rank(p text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'pro' THEN 3 WHEN 'growth' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END
$$;

-- What a workspace gets right now: the better of its paid plan (an active subscription) and a live complimentary grant. Never anything else.
CREATE OR REPLACE FUNCTION public.effective_plan(p_tenant uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH paid AS (SELECT s.plan FROM public.subscriptions s WHERE s.tenant_id = p_tenant AND s.status = 'active' ORDER BY public.plan_rank(s.plan) DESC LIMIT 1),
       comp AS (SELECT t.comp_plan AS plan FROM public.tenants t WHERE t.id = p_tenant AND t.comp_plan IS NOT NULL AND t.comp_until > now())
  SELECT coalesce((SELECT plan FROM (SELECT plan FROM paid UNION ALL SELECT plan FROM comp) x ORDER BY public.plan_rank(plan) DESC LIMIT 1), 'free')
$$;

-- Giving or ending a gift changes what a customer can do, so, like viewing a customer, it needs two-step sign-in checked here in the database and not only in the app.
-- Give a workspace a plan for a limited time, for free.
CREATE OR REPLACE FUNCTION public.admin_grant_plan(p_id uuid, p_plan text, p_days int, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v text; t record; r text := btrim(coalesce(p_reason, '')); old text; new_plan text; until_at timestamptz;
BEGIN
  v := public.admin_guard();
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = v AND two_factor_enabled) THEN RAISE EXCEPTION 'platform admin only' USING ERRCODE = '42501'; END IF;
  IF p_plan NOT IN ('starter','growth','pro') THEN RAISE EXCEPTION 'choose Starter, Growth or Pro' USING ERRCODE = '22023'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN RAISE EXCEPTION 'choose between 1 and 365 days' USING ERRCODE = '22023'; END IF;
  IF char_length(r) < 5 THEN RAISE EXCEPTION 'give a reason of at least 5 characters' USING ERRCODE = '22023'; END IF;
  IF char_length(r) > 200 THEN RAISE EXCEPTION 'the reason is too long (200 characters at most)' USING ERRCODE = '22023'; END IF;
  SELECT id, plan_id, closed_at, status INTO t FROM public.tenants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF t.closed_at IS NOT NULL THEN RAISE EXCEPTION 'this workspace has been closed' USING ERRCODE = '22023'; END IF;
  -- A customer who pays has a subscription that billing owns. A grant on top would be confusing and could hide a failed payment.
  IF EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.tenant_id = p_id AND s.status IN ('active','authenticated','pending','halted','paused')) THEN
    RAISE EXCEPTION 'this workspace has a paid subscription; change it through billing, not as a gift' USING ERRCODE = '22023';
  END IF;
  old := t.plan_id; until_at := now() + make_interval(days => p_days);
  UPDATE public.tenants SET comp_plan = p_plan, comp_until = until_at, comp_reason = r, comp_granted_by = v, comp_granted_at = now() WHERE id = p_id;
  new_plan := public.effective_plan(p_id);
  UPDATE public.tenants SET plan_id = new_plan, updated_at = now() WHERE id = p_id;
  PERFORM public.admin_log(p_id, 'admin.plan_granted', 'tenant', p_id::text, jsonb_build_object('plan', p_plan, 'days', p_days, 'until', until_at, 'reason', r, 'from', old));
  RETURN jsonb_build_object('plan', new_plan, 'from', old, 'until', until_at);
END $$;

-- End a grant early. The workspace falls back to whatever it pays for (nothing, for a free workspace).
CREATE OR REPLACE FUNCTION public.admin_end_grant(p_id uuid, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v text; r text := btrim(coalesce(p_reason, '')); t record; new_plan text;
BEGIN
  v := public.admin_guard();
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = v AND two_factor_enabled) THEN RAISE EXCEPTION 'platform admin only' USING ERRCODE = '42501'; END IF;
  IF char_length(r) < 5 THEN RAISE EXCEPTION 'give a reason of at least 5 characters' USING ERRCODE = '22023'; END IF;
  IF char_length(r) > 200 THEN RAISE EXCEPTION 'the reason is too long (200 characters at most)' USING ERRCODE = '22023'; END IF;
  SELECT id, plan_id, comp_plan, comp_until INTO t FROM public.tenants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF t.comp_plan IS NULL THEN RETURN jsonb_build_object('ended', false); END IF;
  UPDATE public.tenants SET comp_plan = NULL, comp_until = NULL, comp_reason = NULL, comp_granted_by = NULL, comp_granted_at = NULL WHERE id = p_id;
  new_plan := public.effective_plan(p_id);
  UPDATE public.tenants SET plan_id = new_plan, updated_at = now() WHERE id = p_id;
  PERFORM public.admin_log(p_id, 'admin.grant_ended', 'tenant', p_id::text, jsonb_build_object('plan', t.comp_plan, 'was_until', t.comp_until, 'reason', r, 'now', new_plan));
  RETURN jsonb_build_object('ended', true, 'plan', new_plan);
END $$;

-- What staff see on the workspace page: the plan, where it comes from, and any grant.
CREATE OR REPLACE FUNCTION public.admin_plan_info(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t record; s record;
BEGIN
  PERFORM public.admin_guard();
  SELECT plan_id, comp_plan, comp_until, comp_reason, comp_granted_at, (SELECT u.email FROM public."user" u WHERE u.id = comp_granted_by) AS granted_by, status INTO t FROM public.tenants WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT plan, status, current_end, cancel_at_cycle_end INTO s FROM public.subscriptions WHERE tenant_id = p_id AND status IN ('active','authenticated','pending','halted','paused') ORDER BY updated_at DESC LIMIT 1;
  RETURN jsonb_build_object('plan', t.plan_id, 'effective', public.effective_plan(p_id),
    'paid', CASE WHEN s.plan IS NULL THEN NULL ELSE jsonb_build_object('plan', s.plan, 'status', s.status, 'currentEnd', s.current_end, 'cancelAtCycleEnd', s.cancel_at_cycle_end) END,
    'grant', CASE WHEN t.comp_plan IS NULL THEN NULL ELSE jsonb_build_object('plan', t.comp_plan, 'until', t.comp_until, 'reason', t.comp_reason, 'grantedAt', t.comp_granted_at, 'by', t.granted_by, 'live', t.comp_until > now()) END);
END $$;

-- The plan staff used to set by hand, with no end and no record. Replaced by grants above.
DROP FUNCTION public.admin_set_plan(uuid, text, text);

REVOKE ALL ON FUNCTION public.effective_plan(uuid), public.admin_grant_plan(uuid, text, int, text), public.admin_end_grant(uuid, text), public.admin_plan_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_plan(uuid, text, int, text), public.admin_end_grant(uuid, text), public.admin_plan_info(uuid) TO app;
GRANT EXECUTE ON FUNCTION public.effective_plan(uuid) TO worker;

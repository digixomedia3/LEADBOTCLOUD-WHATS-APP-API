-- Super admin (platform staff) panel. Append-only.
-- Staff are listed in platform_admins by user id (not by email: an email allow-list could be claimed by anyone who signs up with it first).
-- The panel never uses the RLS-bypassing worker credentials. It calls the SECURITY DEFINER functions below as the normal `app` role;
-- each one checks the caller is a platform admin, does one narrow thing, and writes an audit entry that names the admin.

CREATE TABLE public.platform_admins (
  user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  added_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins FORCE ROW LEVEL SECURITY;
-- A signed-in user can see whether THEY are staff, nothing else. Nobody can add or remove rows through the app role.
CREATE POLICY platform_admins_self ON public.platform_admins FOR SELECT TO app USING (user_id = public.current_user_id());
CREATE POLICY platform_admins_owner ON public.platform_admins FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.platform_admins FROM app, worker;
GRANT SELECT ON public.platform_admins TO app;
GRANT ALL ON public.platform_admins TO owner;

ALTER TABLE public.tenants ADD COLUMN suspended_from text, ADD COLUMN suspended_reason text, ADD COLUMN suspended_at timestamptz;
GRANT SELECT (suspended_from, suspended_reason, suspended_at) ON public.tenants TO app, worker;
GRANT UPDATE (suspended_from, suspended_reason, suspended_at) ON public.tenants TO worker;

-- Announcements shown as a banner to every workspace. Anyone signed in can read the live ones; only staff (via functions) can change them.
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL CHECK (char_length(message) BETWEEN 3 AND 300),
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  active boolean NOT NULL DEFAULT true,
  ends_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements FORCE ROW LEVEL SECURITY;
CREATE POLICY announcements_read ON public.announcements FOR SELECT TO app USING (active AND (ends_at IS NULL OR ends_at > now()));
CREATE POLICY announcements_owner ON public.announcements FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.announcements FROM app, worker;
GRANT SELECT ON public.announcements TO app;
GRANT ALL ON public.announcements TO owner;

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = public.current_user_id())
$$;

-- Internal: refuse anyone who is not staff. Never granted to app directly.
CREATE OR REPLACE FUNCTION public.admin_guard() RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v text := public.current_user_id();
BEGIN
  IF v IS NULL OR v = '' OR NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v) THEN
    RAISE EXCEPTION 'platform admin only' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.admin_log(p_tenant uuid, p_action text, p_entity text, p_entity_id text, p_after jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, actor_user_id, actor_type, action, entity, entity_id, after)
  VALUES (p_tenant, public.current_user_id(), 'super_admin', p_action, p_entity, p_entity_id, p_after);
END $$;
REVOKE ALL ON FUNCTION public.admin_guard(), public.admin_log(uuid, text, text, text, jsonb) FROM PUBLIC, app;

-- Platform numbers for the overview page.
CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'tenants', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*)::int n FROM public.tenants GROUP BY 1) x),
    'plans', (SELECT coalesce(jsonb_object_agg(plan_id, n), '{}'::jsonb) FROM (SELECT plan_id, count(*)::int n FROM public.tenants WHERE status NOT IN ('offboarded') GROUP BY 1) x),
    'users', (SELECT count(*)::int FROM public."user"),
    'newTenants7d', (SELECT count(*)::int FROM public.tenants WHERE created_at > now() - interval '7 days'),
    'connected', (SELECT count(*)::int FROM public.meta_accounts WHERE token_status = 'valid'),
    'tokenProblems', (SELECT count(*)::int FROM public.meta_accounts WHERE token_status <> 'valid'),
    'restricted', (SELECT count(*)::int FROM public.meta_accounts WHERE health_state <> 'ok'),
    'flagged', (SELECT count(*)::int FROM public.tenants WHERE vertical_review_status = 'flagged'),
    'messages24h', (SELECT count(*)::int FROM public.messages WHERE direction = 'out' AND created_at > now() - interval '24 hours'),
    'failed24h', (SELECT count(*)::int FROM public.messages WHERE direction = 'out' AND status = 'failed' AND created_at > now() - interval '24 hours'),
    'queued', (SELECT count(*)::int FROM public.messages WHERE direction = 'out' AND status = 'queued' AND wamid IS NULL),
    'campaignsRunning', (SELECT count(*)::int FROM public.campaigns WHERE status IN ('running','scheduled')),
    'journeysRunning', (SELECT count(*)::int FROM public.journey_runs WHERE status = 'active'),
    'webhookBacklog', (SELECT count(*)::int FROM public.webhook_events WHERE processed_at IS NULL AND signature_ok),
    'webhookErrors24h', (SELECT count(*)::int FROM public.webhook_events WHERE process_error IS NOT NULL AND received_at > now() - interval '24 hours'),
    'subs', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*)::int n FROM public.subscriptions GROUP BY 1) x),
    'mrrPaise', (SELECT coalesce(sum(rp.amount_paise), 0)::bigint FROM public.subscriptions s JOIN LATERAL (SELECT amount_paise FROM public.razorpay_plans WHERE razorpay_plan_id = s.razorpay_plan_id LIMIT 1) rp ON true WHERE s.status = 'active')
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_tenants(p_search text, p_status text, p_limit int, p_offset int) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r jsonb; s text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM public.tenants t WHERE (p_status IS NULL OR t.status = p_status) AND (s IS NULL OR t.name ILIKE '%' || replace(replace(s, '%', ''), '_', '') || '%' OR t.id::text = s
         OR EXISTS (SELECT 1 FROM public.tenant_members m JOIN public."user" u ON u.id = m.user_id WHERE m.tenant_id = t.id AND u.email ILIKE '%' || replace(replace(s, '%', ''), '_', '') || '%'))),
    'rows', coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt' DESC) FROM (
      SELECT jsonb_build_object(
        'id', t.id, 'name', t.name, 'status', t.status, 'plan', t.plan_id, 'vertical', t.vertical, 'review', t.vertical_review_status, 'createdAt', t.created_at,
        'members', (SELECT count(*)::int FROM public.tenant_members m WHERE m.tenant_id = t.id),
        'owner', (SELECT u.email FROM public.tenant_members m JOIN public."user" u ON u.id = m.user_id WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1),
        'contacts', (SELECT count(*)::int FROM public.contacts c WHERE c.tenant_id = t.id),
        'sent30d', (SELECT count(*)::int FROM public.messages ms WHERE ms.tenant_id = t.id AND ms.direction = 'out' AND ms.created_at > now() - interval '30 days'),
        'token', (SELECT a.token_status FROM public.meta_accounts a WHERE a.tenant_id = t.id), 'health', (SELECT a.health_state FROM public.meta_accounts a WHERE a.tenant_id = t.id),
        'lastActive', (SELECT max(l.created_at) FROM public.audit_log l WHERE l.tenant_id = t.id AND l.actor_type = 'user')
      ) x
      FROM public.tenants t
      WHERE (p_status IS NULL OR t.status = p_status) AND (s IS NULL OR t.name ILIKE '%' || replace(replace(s, '%', ''), '_', '') || '%' OR t.id::text = s
         OR EXISTS (SELECT 1 FROM public.tenant_members m JOIN public."user" u ON u.id = m.user_id WHERE m.tenant_id = t.id AND u.email ILIKE '%' || replace(replace(s, '%', ''), '_', '') || '%'))
      ORDER BY t.created_at DESC LIMIT least(greatest(coalesce(p_limit, 25), 1), 100) OFFSET greatest(coalesce(p_offset, 0), 0)) q), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;

-- One workspace in detail. Reading it is itself logged, because it shows personal data (member emails).
CREATE OR REPLACE FUNCTION public.admin_tenant(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.admin_guard();
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_id) THEN RETURN NULL; END IF;
  PERFORM public.admin_log(p_id, 'admin.viewed_workspace', 'tenant', p_id::text, '{}'::jsonb);
  SELECT jsonb_build_object(
    'id', t.id, 'name', t.name, 'legalName', t.legal_name, 'gstin', t.gstin, 'status', t.status, 'plan', t.plan_id, 'vertical', t.vertical, 'review', t.vertical_review_status,
    'createdAt', t.created_at, 'suspendedReason', t.suspended_reason, 'suspendedAt', t.suspended_at, 'suspendedFrom', t.suspended_from,
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object('name', u.name, 'email', u.email, 'role', m.role) ORDER BY m.created_at) FROM public.tenant_members m JOIN public."user" u ON u.id = m.user_id WHERE m.tenant_id = t.id), '[]'::jsonb),
    'connection', (SELECT jsonb_build_object('wabaId', a.messaging_account_id, 'token', a.token_status, 'health', a.health_state, 'payment', a.payment_method_status,
        'phone', (SELECT jsonb_build_object('display', p.display_phone_number, 'name', p.verified_name, 'quality', p.quality_rating, 'status', p.status) FROM public.phone_numbers p WHERE p.meta_account_id = a.id ORDER BY p.created_at LIMIT 1)) FROM public.meta_accounts a WHERE a.tenant_id = t.id),
    'subscription', (SELECT jsonb_build_object('plan', s.plan, 'status', s.status, 'currentEnd', s.current_end, 'cancelAtCycleEnd', s.cancel_at_cycle_end) FROM public.subscriptions s WHERE s.tenant_id = t.id ORDER BY s.created_at DESC LIMIT 1),
    'usage', jsonb_build_object(
      'contacts', (SELECT count(*)::int FROM public.contacts c WHERE c.tenant_id = t.id),
      'sent30d', (SELECT count(*)::int FROM public.messages m WHERE m.tenant_id = t.id AND m.direction = 'out' AND m.created_at > now() - interval '30 days'),
      'failed30d', (SELECT count(*)::int FROM public.messages m WHERE m.tenant_id = t.id AND m.direction = 'out' AND m.status = 'failed' AND m.created_at > now() - interval '30 days'),
      'campaigns', (SELECT count(*)::int FROM public.campaigns c WHERE c.tenant_id = t.id),
      'templates', (SELECT count(*)::int FROM public.templates x WHERE x.tenant_id = t.id),
      'journeysActive', (SELECT count(*)::int FROM public.journeys j WHERE j.tenant_id = t.id AND j.status = 'active')),
    'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('action', l.action, 'actor', l.actor_type, 'at', l.created_at) ORDER BY l.created_at DESC) FROM (SELECT * FROM public.audit_log WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 12) l), '[]'::jsonb)
  ) INTO r FROM public.tenants t WHERE t.id = p_id;
  RETURN r;
END $$;

-- Suspend or reactivate. Suspending remembers the previous state, pauses everything that sends, and records why. Reactivating restores the state but
-- does NOT restart campaigns or journeys: the owner decides.
CREATE OR REPLACE FUNCTION public.admin_set_suspended(p_id uuid, p_suspend boolean, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.tenants%ROWTYPE; n_c int := 0; n_j int := 0; why text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM public.admin_guard();
  SELECT * INTO t FROM public.tenants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF p_suspend THEN
    IF why IS NULL OR char_length(why) < 5 THEN RAISE EXCEPTION 'a reason of at least 5 characters is required' USING ERRCODE = '22023'; END IF;
    IF t.status = 'suspended' THEN RETURN jsonb_build_object('changed', false, 'status', 'suspended'); END IF;
    IF t.status = 'offboarded' THEN RAISE EXCEPTION 'this workspace was offboarded' USING ERRCODE = '22023'; END IF;
    UPDATE public.tenants SET status = 'suspended', suspended_from = t.status, suspended_reason = left(why, 300), suspended_at = now(), updated_at = now() WHERE id = p_id;
    UPDATE public.campaigns SET status = 'paused', pause_reason = 'workspace_suspended' WHERE tenant_id = p_id AND status IN ('scheduled','running');
    GET DIAGNOSTICS n_c = ROW_COUNT;
    UPDATE public.journeys SET status = 'paused', updated_at = now() WHERE tenant_id = p_id AND status = 'active';
    GET DIAGNOSTICS n_j = ROW_COUNT;
    PERFORM public.admin_log(p_id, 'admin.suspended', 'tenant', p_id::text, jsonb_build_object('reason', left(why, 300), 'from', t.status, 'campaignsPaused', n_c, 'journeysPaused', n_j));
    RETURN jsonb_build_object('changed', true, 'status', 'suspended', 'campaignsPaused', n_c, 'journeysPaused', n_j);
  END IF;
  IF t.status <> 'suspended' THEN RETURN jsonb_build_object('changed', false, 'status', t.status); END IF;
  UPDATE public.tenants SET status = coalesce(nullif(t.suspended_from, 'suspended'), 'onboarding'), suspended_from = NULL, suspended_reason = NULL, suspended_at = NULL, updated_at = now() WHERE id = p_id;
  PERFORM public.admin_log(p_id, 'admin.reactivated', 'tenant', p_id::text, jsonb_build_object('to', coalesce(nullif(t.suspended_from, 'suspended'), 'onboarding')));
  RETURN jsonb_build_object('changed', true, 'status', coalesce(nullif(t.suspended_from, 'suspended'), 'onboarding'));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_plan(p_id uuid, p_plan text, p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE old text;
BEGIN
  PERFORM public.admin_guard();
  IF p_plan NOT IN ('free','starter','growth','pro') THEN RAISE EXCEPTION 'unknown plan' USING ERRCODE = '22023'; END IF;
  SELECT plan_id INTO old FROM public.tenants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF old = p_plan THEN RETURN jsonb_build_object('changed', false, 'plan', old); END IF;
  UPDATE public.tenants SET plan_id = p_plan, updated_at = now() WHERE id = p_id;
  PERFORM public.admin_log(p_id, 'admin.plan_changed', 'tenant', p_id::text, jsonb_build_object('from', old, 'to', p_plan, 'note', left(coalesce(p_note, ''), 200)));
  RETURN jsonb_build_object('changed', true, 'plan', p_plan, 'from', old);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_review(p_id uuid, p_review text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE old text;
BEGIN
  PERFORM public.admin_guard();
  IF p_review NOT IN ('none','flagged','approved','blocked') THEN RAISE EXCEPTION 'unknown review status' USING ERRCODE = '22023'; END IF;
  SELECT vertical_review_status INTO old FROM public.tenants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF old = p_review THEN RETURN jsonb_build_object('changed', false, 'review', old); END IF;
  UPDATE public.tenants SET vertical_review_status = p_review, updated_at = now() WHERE id = p_id;
  PERFORM public.admin_log(p_id, 'admin.review_changed', 'tenant', p_id::text, jsonb_build_object('from', old, 'to', p_review));
  RETURN jsonb_build_object('changed', true, 'review', p_review);
END $$;

CREATE OR REPLACE FUNCTION public.admin_audit(p_limit int, p_before bigint, p_tenant uuid, p_prefix text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN coalesce((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('id', l.id, 'at', l.created_at, 'tenantId', l.tenant_id, 'tenant', t.name, 'actorType', l.actor_type,
           'actor', (SELECT u.email FROM public."user" u WHERE u.id = l.actor_user_id), 'action', l.action, 'entity', l.entity, 'after', l.after) x
    FROM public.audit_log l LEFT JOIN public.tenants t ON t.id = l.tenant_id
    WHERE (p_before IS NULL OR l.id < p_before) AND (p_tenant IS NULL OR l.tenant_id = p_tenant)
      AND (nullif(p_prefix, '') IS NULL OR l.action LIKE replace(replace(p_prefix, '%', ''), '_', '') || '%')
    ORDER BY l.id DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) q), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_announcements() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'message', a.message, 'level', a.level, 'active', a.active, 'endsAt', a.ends_at, 'createdAt', a.created_at) ORDER BY a.created_at DESC) FROM (SELECT * FROM public.announcements ORDER BY created_at DESC LIMIT 50) a), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_announce(p_message text, p_level text, p_hours int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; m text := btrim(coalesce(p_message, ''));
BEGIN
  PERFORM public.admin_guard();
  IF char_length(m) < 3 OR char_length(m) > 300 THEN RAISE EXCEPTION 'the message must be 3 to 300 characters' USING ERRCODE = '22023'; END IF;
  IF p_level NOT IN ('info','warning','critical') THEN RAISE EXCEPTION 'unknown level' USING ERRCODE = '22023'; END IF;
  IF p_hours IS NOT NULL AND (p_hours < 1 OR p_hours > 24 * 90) THEN RAISE EXCEPTION 'choose 1 hour to 90 days' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.announcements (message, level, ends_at, created_by) VALUES (m, p_level, CASE WHEN p_hours IS NULL THEN NULL ELSE now() + make_interval(hours => p_hours) END, public.current_user_id()) RETURNING id INTO v_id;
  PERFORM public.admin_log(NULL, 'admin.announced', 'announcement', v_id::text, jsonb_build_object('level', p_level, 'message', left(m, 120)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_end_announcement(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  UPDATE public.announcements SET active = false WHERE id = p_id AND active;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.admin_log(NULL, 'admin.announcement_ended', 'announcement', p_id::text, '{}'::jsonb);
  RETURN true;
END $$;

-- The app role may call exactly these, and nothing else here. Each starts with admin_guard().
REVOKE ALL ON FUNCTION public.is_platform_admin(), public.admin_overview(), public.admin_tenants(text, text, int, int), public.admin_tenant(uuid), public.admin_set_suspended(uuid, boolean, text),
  public.admin_set_plan(uuid, text, text), public.admin_set_review(uuid, text), public.admin_audit(int, bigint, uuid, text), public.admin_announcements(),
  public.admin_announce(text, text, int), public.admin_end_announcement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(), public.admin_overview(), public.admin_tenants(text, text, int, int), public.admin_tenant(uuid), public.admin_set_suspended(uuid, boolean, text),
  public.admin_set_plan(uuid, text, text), public.admin_set_review(uuid, text), public.admin_audit(int, bigint, uuid, text), public.admin_announcements(),
  public.admin_announce(text, text, int), public.admin_end_announcement(uuid) TO app;

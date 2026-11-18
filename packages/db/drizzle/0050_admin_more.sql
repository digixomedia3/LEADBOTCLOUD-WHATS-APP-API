-- Super admin, second round. Append-only.
-- New staff tools: a "needs attention" queue, workspace closures (with a staff cancel), accounts and sign-outs, revenue, a staff list, internal notes on a workspace
-- and the most common send errors per workspace. Same rules as before: each function starts with admin_guard(), does one narrow thing, and every change or read
-- of personal data writes an audit entry that names the admin.

-- Read access for the role the admin functions run as. The session table holds sign-in tokens, so the admin functions never select the token column.
GRANT SELECT ON public."user" TO owner;
GRANT SELECT, DELETE ON public.session TO owner;
GRANT SELECT ON public.invoices TO owner;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invoices' AND policyname = 'owner_read_for_admin') THEN
    CREATE POLICY owner_read_for_admin ON public.invoices FOR SELECT TO owner USING (true);
  END IF;
END $$;

-- Internal notes about a workspace. Staff only: the app and worker roles cannot see or change this table.
CREATE TABLE public.admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (char_length(note) BETWEEN 3 AND 1000),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_notes_tenant_idx ON public.admin_notes (tenant_id, created_at DESC);
ALTER TABLE public.admin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_notes_owner ON public.admin_notes FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.admin_notes FROM app, worker;
GRANT ALL ON public.admin_notes TO owner;

-- ---------------------------------------------------------------- needs attention
-- One list of every workspace with something wrong, worst first. Each reason has a severity (high, warn, info) and a weight that makes up the score.
CREATE OR REPLACE FUNCTION public.admin_attention() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'score')::int DESC, x->>'name') FROM (
    SELECT jsonb_build_object('id', q.id, 'name', q.name, 'status', q.status, 'plan', q.plan_id, 'owner', q.owner, 'reasons', q.reasons,
      'score', (SELECT coalesce(sum((r->>'weight')::int), 0) FROM jsonb_array_elements(q.reasons) r)) x
    FROM (
      SELECT t.id, t.name, t.status, t.plan_id,
        (SELECT u.email FROM public.tenant_members m JOIN public."user" u ON u.id = m.user_id WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner,
        (CASE WHEN ma.token_status IS NOT NULL AND ma.token_status <> 'valid' THEN jsonb_build_array(jsonb_build_object('code', 'token', 'severity', 'high', 'weight', 3, 'detail', 'WhatsApp sign-in is ' || ma.token_status)) ELSE '[]'::jsonb END)
        || (CASE WHEN ma.health_state IS NOT NULL AND ma.health_state <> 'ok' THEN jsonb_build_array(jsonb_build_object('code', 'restricted', 'severity', 'high', 'weight', 3, 'detail', 'Meta reports the account as ' || ma.health_state)) ELSE '[]'::jsonb END)
        || (CASE WHEN ph.quality_rating = 'RED' THEN jsonb_build_array(jsonb_build_object('code', 'quality', 'severity', 'high', 'weight', 3, 'detail', 'Number quality is low (red)'))
                 WHEN ph.quality_rating = 'YELLOW' THEN jsonb_build_array(jsonb_build_object('code', 'quality', 'severity', 'warn', 'weight', 1, 'detail', 'Number quality is medium (yellow)')) ELSE '[]'::jsonb END)
        || (CASE WHEN ms.sent >= 20 AND ms.failed * 100 >= ms.sent * 30 THEN jsonb_build_array(jsonb_build_object('code', 'failing', 'severity', 'high', 'weight', 3, 'detail', ms.failed || ' of ' || ms.sent || ' sends failed in 7 days'))
                 WHEN ms.sent >= 20 AND ms.failed * 100 >= ms.sent * 10 THEN jsonb_build_array(jsonb_build_object('code', 'failing', 'severity', 'warn', 'weight', 2, 'detail', ms.failed || ' of ' || ms.sent || ' sends failed in 7 days')) ELSE '[]'::jsonb END)
        || (CASE WHEN sb.status = 'halted' THEN jsonb_build_array(jsonb_build_object('code', 'billing', 'severity', 'high', 'weight', 3, 'detail', 'Subscription payments stopped (halted)'))
                 WHEN sb.status IN ('pending', 'paused') THEN jsonb_build_array(jsonb_build_object('code', 'billing', 'severity', 'warn', 'weight', 2, 'detail', 'Subscription is ' || sb.status)) ELSE '[]'::jsonb END)
        || (CASE WHEN t.vertical_review_status = 'blocked' THEN jsonb_build_array(jsonb_build_object('code', 'review', 'severity', 'high', 'weight', 2, 'detail', 'Blocked after review'))
                 WHEN t.vertical_review_status = 'flagged' THEN jsonb_build_array(jsonb_build_object('code', 'review', 'severity', 'warn', 'weight', 2, 'detail', 'Flagged for review')) ELSE '[]'::jsonb END)
        || (CASE WHEN wh.n >= 5 THEN jsonb_build_array(jsonb_build_object('code', 'webhooks', 'severity', 'warn', 'weight', 1, 'detail', wh.n || ' incoming events failed in 24 hours')) ELSE '[]'::jsonb END)
        || (CASE WHEN t.closure_due_at IS NOT NULL AND t.closed_at IS NULL THEN jsonb_build_array(jsonb_build_object('code', 'closing', 'severity', 'info', 'weight', 1, 'detail', 'Closing on ' || to_char(t.closure_due_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY'))) ELSE '[]'::jsonb END)
        || (CASE WHEN t.status = 'suspended' THEN jsonb_build_array(jsonb_build_object('code', 'suspended', 'severity', 'info', 'weight', 1, 'detail', coalesce(t.suspended_reason, 'Suspended'))) ELSE '[]'::jsonb END)
        AS reasons
      FROM public.tenants t
      LEFT JOIN public.meta_accounts ma ON ma.tenant_id = t.id
      LEFT JOIN LATERAL (SELECT p.quality_rating FROM public.phone_numbers p WHERE p.meta_account_id = ma.id ORDER BY p.created_at LIMIT 1) ph ON true
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE m.direction = 'out')::int AS sent, count(*) FILTER (WHERE m.direction = 'out' AND m.status = 'failed')::int AS failed
                         FROM public.messages m WHERE m.tenant_id = t.id AND m.created_at > now() - interval '7 days') ms ON true
      LEFT JOIN LATERAL (SELECT s.status FROM public.subscriptions s WHERE s.tenant_id = t.id ORDER BY s.created_at DESC LIMIT 1) sb ON true
      LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM public.webhook_events w WHERE w.tenant_id = t.id AND w.process_error IS NOT NULL AND w.received_at > now() - interval '24 hours') wh ON true
      WHERE t.status <> 'offboarded'
    ) q WHERE jsonb_array_length(q.reasons) > 0 LIMIT 300) z), '[]'::jsonb);
END $$;

-- ---------------------------------------------------------------- closures
CREATE OR REPLACE FUNCTION public.admin_closures() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN jsonb_build_object(
    'pending', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'status', t.status, 'plan', t.plan_id, 'requestedAt', t.closure_requested_at, 'dueAt', t.closure_due_at,
        'requestedBy', (SELECT u.email FROM public."user" u WHERE u.id = t.closure_requested_by),
        'daysLeft', greatest(0, ceil(extract(epoch FROM (t.closure_due_at - now())) / 86400))::int,
        'inProgress', t.status = 'offboarded',
        'contacts', (SELECT count(*)::int FROM public.contacts c WHERE c.tenant_id = t.id),
        'members', (SELECT count(*)::int FROM public.tenant_members m WHERE m.tenant_id = t.id)) ORDER BY t.closure_due_at)
      FROM public.tenants t WHERE t.closure_due_at IS NOT NULL AND t.closed_at IS NULL), '[]'::jsonb),
    'closed', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'plan', c.plan_id, 'closedAt', c.closed_at, 'requestedAt', c.closure_requested_at) ORDER BY c.closed_at DESC)
      FROM (SELECT * FROM public.tenants WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 25) c), '[]'::jsonb));
END $$;

-- Staff can stop a closure that has not started erasing. Once the worker has begun (status offboarded) it cannot be undone, because data is already gone.
CREATE OR REPLACE FUNCTION public.admin_cancel_closure(p_id uuid, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.tenants%ROWTYPE; why text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM public.admin_guard();
  SELECT * INTO t FROM public.tenants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF why IS NULL OR char_length(why) < 5 THEN RAISE EXCEPTION 'a reason of at least 5 characters is required' USING ERRCODE = '22023'; END IF;
  IF t.closure_due_at IS NULL THEN RETURN jsonb_build_object('changed', false); END IF;
  IF t.closed_at IS NOT NULL OR t.status = 'offboarded' THEN RAISE EXCEPTION 'this workspace is already being erased and cannot be restored' USING ERRCODE = '22023'; END IF;
  UPDATE public.tenants SET closure_requested_at = NULL, closure_due_at = NULL, closure_requested_by = NULL, updated_at = now() WHERE id = p_id;
  PERFORM public.admin_log(p_id, 'admin.closure_cancelled', 'tenant', p_id::text, jsonb_build_object('reason', left(why, 300), 'wasDue', t.closure_due_at, 'requestedBy', t.closure_requested_by));
  RETURN jsonb_build_object('changed', true);
END $$;

-- ---------------------------------------------------------------- accounts
-- Finding a person by email or name. Results show personal data, so every search is logged with the words searched. Empty search lists the newest accounts.
CREATE OR REPLACE FUNCTION public.admin_users(p_search text, p_limit int) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s text := nullif(btrim(coalesce(p_search, '')), ''); pat text;
BEGIN
  PERFORM public.admin_guard();
  PERFORM public.admin_log(NULL, 'admin.searched_users', 'user', NULL, jsonb_build_object('search', left(coalesce(s, ''), 80)));
  pat := CASE WHEN s IS NULL THEN NULL ELSE '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'createdAt' DESC) FROM (
    SELECT jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'verified', u.email_verified, 'createdAt', u.created_at,
      'staff', EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.user_id = u.id),
      'sessions', (SELECT count(*)::int FROM public.session s2 WHERE s2.user_id = u.id AND s2.expires_at > now()),
      'lastSeen', (SELECT max(s2.updated_at) FROM public.session s2 WHERE s2.user_id = u.id),
      'workspaces', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', m.role, 'status', t.status) ORDER BY m.created_at)
                              FROM public.tenant_members m JOIN public.tenants t ON t.id = m.tenant_id WHERE m.user_id = u.id), '[]'::jsonb)) x
    FROM public."user" u WHERE pat IS NULL OR u.email ILIKE pat OR u.name ILIKE pat
    ORDER BY u.created_at DESC LIMIT least(greatest(coalesce(p_limit, 25), 1), 50)) q), '[]'::jsonb);
END $$;

-- End every sign-in a person has, for example after a lost phone or a suspected break-in. They can sign in again with their password.
CREATE OR REPLACE FUNCTION public.admin_sign_out_user(p_user text, p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE me text; u public."user"%ROWTYPE; n int; why text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  me := public.admin_guard();
  IF why IS NULL OR char_length(why) < 5 THEN RAISE EXCEPTION 'a reason of at least 5 characters is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO u FROM public."user" WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'P0002'; END IF;
  IF u.id = me THEN RAISE EXCEPTION 'use the normal sign out for your own account' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.session WHERE user_id = u.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.admin_log(NULL, 'admin.signed_out_user', 'user', u.id, jsonb_build_object('email', u.email, 'sessionsEnded', n, 'reason', left(why, 300)));
  RETURN jsonb_build_object('ended', n);
END $$;

-- ---------------------------------------------------------------- revenue
CREATE OR REPLACE FUNCTION public.admin_revenue() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN jsonb_build_object(
    'byPlan', coalesce((SELECT jsonb_agg(jsonb_build_object('plan', x.plan, 'count', x.n, 'paise', x.paise) ORDER BY x.paise DESC) FROM (
        SELECT s.plan, count(*)::int n, coalesce(sum(rp.amount_paise), 0)::bigint paise
        FROM public.subscriptions s LEFT JOIN LATERAL (SELECT amount_paise FROM public.razorpay_plans WHERE razorpay_plan_id = s.razorpay_plan_id LIMIT 1) rp ON true
        WHERE s.status = 'active' GROUP BY s.plan) x), '[]'::jsonb),
    'subs', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*)::int n FROM public.subscriptions GROUP BY 1) x),
    'months', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m.mon, 'count', m.n, 'basePaise', m.base, 'gstPaise', m.gst, 'totalPaise', m.total) ORDER BY m.mon DESC) FROM (
        SELECT to_char(i.issued_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') mon, count(*)::int n, sum(i.base_paise)::bigint base, sum(i.gst_paise)::bigint gst, sum(i.total_paise)::bigint total
        FROM public.invoices i WHERE i.issued_at > now() - interval '6 months' GROUP BY 1) m), '[]'::jsonb),
    'renewals', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'plan', s.plan, 'end', s.current_end, 'cancelAtEnd', s.cancel_at_cycle_end) ORDER BY s.current_end)
        FROM public.subscriptions s JOIN public.tenants t ON t.id = s.tenant_id WHERE s.status = 'active' AND s.current_end BETWEEN now() AND now() + interval '14 days'), '[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('number', r.number, 'tenantId', r.tenant_id, 'tenant', r.name, 'totalPaise', r.total_paise, 'at', r.issued_at) ORDER BY r.issued_at DESC)
        FROM (SELECT i.number, i.tenant_id, t.name, i.total_paise, i.issued_at FROM public.invoices i LEFT JOIN public.tenants t ON t.id = i.tenant_id ORDER BY i.issued_at DESC LIMIT 10) r), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------- staff
CREATE OR REPLACE FUNCTION public.admin_staff() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'since', a.created_at,
      'addedBy', (SELECT b.email FROM public."user" b WHERE b.id = a.added_by),
      'actions30d', (SELECT count(*)::int FROM public.audit_log l WHERE l.actor_user_id = a.user_id AND l.actor_type = 'super_admin' AND l.created_at > now() - interval '30 days'),
      'lastAction', (SELECT max(l.created_at) FROM public.audit_log l WHERE l.actor_user_id = a.user_id AND l.actor_type = 'super_admin'),
      'sessions', (SELECT count(*)::int FROM public.session s WHERE s.user_id = a.user_id AND s.expires_at > now())) ORDER BY a.created_at)
    FROM public.platform_admins a JOIN public."user" u ON u.id = a.user_id), '[]'::jsonb);
END $$;

-- ---------------------------------------------------------------- one workspace: notes and send errors
CREATE OR REPLACE FUNCTION public.admin_tenant_extra(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN jsonb_build_object(
    'notes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'note', n.note, 'by', (SELECT u.email FROM public."user" u WHERE u.id = n.created_by), 'at', n.created_at) ORDER BY n.created_at DESC)
        FROM (SELECT * FROM public.admin_notes WHERE tenant_id = p_id ORDER BY created_at DESC LIMIT 50) n), '[]'::jsonb),
    'errors', coalesce((SELECT jsonb_agg(jsonb_build_object('code', e.error_code, 'count', e.n, 'last', e.last) ORDER BY e.n DESC)
        FROM (SELECT m.error_code, count(*)::int n, max(m.created_at) last FROM public.messages m
              WHERE m.tenant_id = p_id AND m.direction = 'out' AND m.status = 'failed' AND m.created_at > now() - interval '7 days' GROUP BY m.error_code ORDER BY count(*) DESC LIMIT 8) e), '[]'::jsonb),
    'closure', (SELECT CASE WHEN t.closure_due_at IS NULL THEN NULL ELSE jsonb_build_object('requestedAt', t.closure_requested_at, 'dueAt', t.closure_due_at, 'closedAt', t.closed_at,
        'requestedBy', (SELECT u.email FROM public."user" u WHERE u.id = t.closure_requested_by)) END FROM public.tenants t WHERE t.id = p_id));
END $$;

CREATE OR REPLACE FUNCTION public.admin_add_note(p_id uuid, p_note text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE me text; v uuid; n text := btrim(coalesce(p_note, ''));
BEGIN
  me := public.admin_guard();
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_id) THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF char_length(n) < 3 OR char_length(n) > 1000 THEN RAISE EXCEPTION 'a note must be 3 to 1000 characters' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.admin_notes (tenant_id, note, created_by) VALUES (p_id, n, me) RETURNING id INTO v;
  PERFORM public.admin_log(p_id, 'admin.note_added', 'tenant', p_id::text, jsonb_build_object('preview', left(n, 80)));
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_attention(), public.admin_closures(), public.admin_cancel_closure(uuid, text), public.admin_users(text, int), public.admin_sign_out_user(text, text),
  public.admin_revenue(), public.admin_staff(), public.admin_tenant_extra(uuid), public.admin_add_note(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_attention(), public.admin_closures(), public.admin_cancel_closure(uuid, text), public.admin_users(text, int), public.admin_sign_out_user(text, text),
  public.admin_revenue(), public.admin_staff(), public.admin_tenant_extra(uuid), public.admin_add_note(uuid, text) TO app;

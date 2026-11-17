-- Super admin fixes. Append-only.
-- 1. The admin functions run as the table-owner role, which Row Level Security applies to. It could not read these tables, so the overview showed zero
--    messages and webhooks and the audit log was empty. Read-only access for that role only; the app and worker roles are unchanged.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','messages','templates','webhook_events','audit_log','subscriptions','journey_runs','razorpay_plans','campaigns','journeys','meta_accounts','phone_numbers','tenant_members'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='owner_read_for_admin') THEN
      EXECUTE format('CREATE POLICY owner_read_for_admin ON public.%I FOR SELECT TO owner USING (true)', t);
    END IF;
  END LOOP;
END $$;

-- 2. Searching for a literal % or _ matched everything, because the characters were deleted instead of escaped.
CREATE OR REPLACE FUNCTION public.admin_tenants(p_search text, p_status text, p_limit int, p_offset int) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r jsonb; s text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
  PERFORM public.admin_guard();
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM public.tenants t WHERE (p_status IS NULL OR t.status = p_status) AND (s IS NULL OR t.name ILIKE '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%' OR t.id::text = s
         OR EXISTS (SELECT 1 FROM public.tenant_members m JOIN public."user" u ON u.id = m.user_id WHERE m.tenant_id = t.id AND u.email ILIKE '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%'))),
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
      WHERE (p_status IS NULL OR t.status = p_status) AND (s IS NULL OR t.name ILIKE '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%' OR t.id::text = s
         OR EXISTS (SELECT 1 FROM public.tenant_members m JOIN public."user" u ON u.id = m.user_id WHERE m.tenant_id = t.id AND u.email ILIKE '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
      ORDER BY t.created_at DESC LIMIT least(greatest(coalesce(p_limit, 25), 1), 100) OFFSET greatest(coalesce(p_offset, 0), 0)) q), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_audit(p_limit int, p_before bigint, p_tenant uuid, p_prefix text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN coalesce((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('id', l.id, 'at', l.created_at, 'tenantId', l.tenant_id, 'tenant', t.name, 'actorType', l.actor_type,
           'actor', (SELECT u.email FROM public."user" u WHERE u.id = l.actor_user_id), 'action', l.action, 'entity', l.entity, 'after', l.after) x
    FROM public.audit_log l LEFT JOIN public.tenants t ON t.id = l.tenant_id
    WHERE (p_before IS NULL OR l.id < p_before) AND (p_tenant IS NULL OR l.tenant_id = p_tenant)
      AND (nullif(p_prefix, '') IS NULL OR l.action LIKE replace(replace(replace(p_prefix, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    ORDER BY l.id DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) q), '[]'::jsonb);
END $$;

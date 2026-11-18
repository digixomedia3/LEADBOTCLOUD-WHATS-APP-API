-- Super admin revenue: a subscription whose price cannot be found (its Razorpay plan is not in razorpay_plans) used to count as zero rupees with no sign
-- anything was wrong, so revenue looked lower than it was. Count them and say how many. Append-only.
CREATE OR REPLACE FUNCTION public.admin_revenue() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.admin_guard();
  RETURN jsonb_build_object(
    'byPlan', coalesce((SELECT jsonb_agg(jsonb_build_object('plan', x.plan, 'count', x.n, 'paise', x.paise, 'unpriced', x.unpriced) ORDER BY x.paise DESC) FROM (
        SELECT s.plan, count(*)::int n, coalesce(sum(rp.amount_paise), 0)::bigint paise, count(*) FILTER (WHERE rp.amount_paise IS NULL)::int unpriced
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

-- LeadBotCloud subscription billing (Razorpay). Append-only.
-- Rules: the browser/web role can NEVER set a plan. tenants.plan_id changes only in the worker, from a signature-verified Razorpay event.

CREATE TABLE public.razorpay_plans (
  plan text NOT NULL,
  amount_paise integer NOT NULL,
  razorpay_plan_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan, amount_paise),
  CONSTRAINT razorpay_plans_rzp_uq UNIQUE (razorpay_plan_id),
  CONSTRAINT razorpay_plans_plan_chk CHECK (plan IN ('starter','growth','pro'))
);
-- Global catalogue (no tenant data): the web role reads it and may add a row the first time a price is used.
GRANT SELECT, INSERT ON public.razorpay_plans TO app;
GRANT SELECT, INSERT ON public.razorpay_plans TO worker;

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan text NOT NULL,
  razorpay_subscription_id text NOT NULL UNIQUE,
  razorpay_plan_id text NOT NULL,
  razorpay_customer_id text,
  status text NOT NULL DEFAULT 'created',
  current_start timestamptz,
  current_end timestamptz,
  paid_count integer NOT NULL DEFAULT 0,
  short_url text,
  cancel_at_cycle_end boolean NOT NULL DEFAULT false,
  pending_plan text,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_plan_chk CHECK (plan IN ('starter','growth','pro')),
  CONSTRAINT subscriptions_status_chk CHECK (status IN ('created','authenticated','active','pending','halted','paused','cancelled','completed','expired'))
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT TO app USING (tenant_id = public.current_tenant_id());
CREATE POLICY subscriptions_owner_all ON public.subscriptions FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.subscriptions FROM app;
GRANT SELECT ON public.subscriptions TO app;
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO worker;

-- Gapless GST invoice numbers per financial year (India: consecutive series). Worker-only.
CREATE TABLE public.invoice_counters (fy text PRIMARY KEY, last_seq integer NOT NULL DEFAULT 0);
GRANT SELECT, INSERT, UPDATE ON public.invoice_counters TO worker;

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number text NOT NULL UNIQUE,
  fy text NOT NULL,
  seq integer NOT NULL,
  razorpay_payment_id text NOT NULL UNIQUE,
  razorpay_invoice_id text,
  plan text NOT NULL,
  base_paise integer NOT NULL,
  gst_paise integer NOT NULL,
  total_paise integer NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  buyer_name text NOT NULL,
  buyer_gstin text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fy, seq),
  CONSTRAINT invoices_sum_chk CHECK (base_paise + gst_paise = total_paise AND base_paise >= 0 AND gst_paise >= 0)
);
CREATE INDEX invoices_tenant_idx ON public.invoices (tenant_id, issued_at DESC);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_select ON public.invoices FOR SELECT TO app USING (tenant_id = public.current_tenant_id());
REVOKE ALL ON public.invoices FROM app;
GRANT SELECT ON public.invoices TO app;
GRANT SELECT, INSERT ON public.invoices TO worker;

-- Raw Razorpay webhooks. Worker only, like webhook_events.
CREATE TABLE public.billing_events (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  signature_ok boolean NOT NULL,
  event text,
  razorpay_subscription_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  process_error text,
  attempts integer NOT NULL DEFAULT 0
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_events FROM app;
GRANT SELECT, INSERT, UPDATE ON public.billing_events TO worker;
GRANT USAGE, SELECT ON SEQUENCE public.billing_events_id_seq TO worker;

-- The web role can no longer write plan_id at all (it was allowed by the original column grants).
REVOKE UPDATE (plan_id) ON public.tenants FROM app;
GRANT UPDATE (plan_id) ON public.tenants TO worker;

-- Records a freshly created Razorpay subscription for the caller's workspace. Owner only.
-- A workspace has at most one subscription row; a new checkout may replace one that never started or already ended, never a live one.
CREATE OR REPLACE FUNCTION public.begin_checkout(p_plan text, p_sub text, p_rzp_plan text, p_short_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_cur text;
BEGIN
  IF v_tenant IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN RAISE EXCEPTION 'begin_checkout: no tenant context' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_tenant AND user_id = public.current_user_id() AND role = 'owner') THEN
    RAISE EXCEPTION 'begin_checkout: owner only' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_cur FROM public.subscriptions WHERE tenant_id = v_tenant;
  IF v_cur IS NOT NULL AND v_cur NOT IN ('created','cancelled','completed','expired') THEN RAISE EXCEPTION 'subscription_live' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.subscriptions (tenant_id, plan, razorpay_subscription_id, razorpay_plan_id, status, short_url)
    VALUES (v_tenant, p_plan, p_sub, p_rzp_plan, 'created', p_short_url)
  ON CONFLICT (tenant_id) DO UPDATE SET plan = EXCLUDED.plan, razorpay_subscription_id = EXCLUDED.razorpay_subscription_id, razorpay_plan_id = EXCLUDED.razorpay_plan_id,
    status = 'created', short_url = EXCLUDED.short_url, current_start = NULL, current_end = NULL, paid_count = 0, cancel_at_cycle_end = false, pending_plan = NULL, last_event_at = NULL, updated_at = now();
  PERFORM public.write_audit('billing.checkout_started', 'subscription', p_sub, jsonb_build_object('plan', p_plan));
END $$;
REVOKE ALL ON FUNCTION public.begin_checkout(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_checkout(text,text,text,text) TO app;

-- Remembers what the owner asked for; the real state still comes from Razorpay's webhook.
CREATE OR REPLACE FUNCTION public.note_billing_change(p_cancel_at_cycle_end boolean, p_pending_plan text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL OR nullif(public.current_user_id(), '') IS NULL THEN RAISE EXCEPTION 'note_billing_change: no tenant context' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_tenant AND user_id = public.current_user_id() AND role = 'owner') THEN
    RAISE EXCEPTION 'note_billing_change: owner only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.subscriptions SET cancel_at_cycle_end = p_cancel_at_cycle_end, pending_plan = p_pending_plan, updated_at = now() WHERE tenant_id = v_tenant;
  PERFORM public.write_audit('billing.change_requested', 'subscription', v_tenant::text, jsonb_build_object('cancel_at_cycle_end', p_cancel_at_cycle_end, 'pending_plan', p_pending_plan));
END $$;
REVOKE ALL ON FUNCTION public.note_billing_change(boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.note_billing_change(boolean,text) TO app;

-- Needs the secret subscription id server-side to call Razorpay; the web role may read its own row (RLS) so it can, but nothing here is a secret.

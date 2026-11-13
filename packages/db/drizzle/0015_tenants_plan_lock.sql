-- A column REVOKE does nothing while a table-level UPDATE grant exists. Drop the table grant and re-grant every column EXCEPT plan_id,
-- so the web role can never change a workspace's plan. Only the worker (from a verified Razorpay event) can.
REVOKE UPDATE ON public.tenants FROM app;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ') INTO cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name <> 'plan_id';
  EXECUTE format('GRANT UPDATE (%s) ON public.tenants TO app', cols);
END $$;

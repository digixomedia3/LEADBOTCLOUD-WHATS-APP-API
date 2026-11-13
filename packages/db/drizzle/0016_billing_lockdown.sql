-- invoice_counters is worker-only: the gapless invoice sequence must not be readable or writable from the web role.
REVOKE ALL ON public.invoice_counters FROM app;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_counters FORCE ROW LEVEL SECURITY;

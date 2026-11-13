-- The plan catalogue is append-only for the web role: it may read it and add a row for a new price, never edit or delete one.
REVOKE UPDATE, DELETE ON public.razorpay_plans FROM app;

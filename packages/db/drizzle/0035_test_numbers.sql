-- Test send (P5). Append-only.
-- A workspace keeps a short list of its own test numbers (up to 5). A test message can only go to a number on that list, so "send a test" can never be
-- used to message strangers. Each number is also a normal contact (tagged test-number), so STOP, delivery and the chat all behave exactly as they do for customers.
CREATE TABLE public.test_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_e164)
);
ALTER TABLE public.test_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_numbers FORCE ROW LEVEL SECURITY;
CREATE POLICY test_numbers_app ON public.test_numbers FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY test_numbers_owner ON public.test_numbers FOR ALL TO owner USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_numbers TO app;
GRANT SELECT ON public.test_numbers TO worker;
GRANT ALL ON public.test_numbers TO owner;

-- At most 5 per workspace, enforced by the database so two quick requests cannot slip a sixth in.
CREATE OR REPLACE FUNCTION public.test_numbers_cap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('test_numbers:' || NEW.tenant_id::text));
  IF (SELECT count(*) FROM public.test_numbers WHERE tenant_id = NEW.tenant_id) >= 5 THEN
    RAISE EXCEPTION 'a workspace can keep at most 5 test numbers' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_numbers_cap_trg BEFORE INSERT ON public.test_numbers FOR EACH ROW EXECUTE FUNCTION public.test_numbers_cap();

-- Test messages are ordinary messages marked as tests, so they can be counted (for the hourly limit) and left out of campaign reports.
ALTER TABLE public.messages ADD COLUMN is_test boolean NOT NULL DEFAULT false;
CREATE INDEX messages_test_recent_idx ON public.messages (tenant_id, created_at) WHERE is_test;

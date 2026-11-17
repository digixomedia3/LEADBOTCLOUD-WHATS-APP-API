-- Journeys (P6, slice 1). Append-only.
-- A journey is a short list of steps (wait, send a template, add a tag). A "run" is one person moving through one journey.
-- Each person goes through a journey once (unique journey + contact), so a lead who resubmits is never enrolled twice.
CREATE TABLE public.journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused')),
  trigger jsonb NOT NULL DEFAULT '{"type":"manual"}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  stop_on_reply boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journeys_steps_chk CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 20),
  CONSTRAINT journeys_trigger_chk CHECK (jsonb_typeof(trigger) = 'object' AND trigger->>'type' IN ('manual','lead_created'))
);
CREATE UNIQUE INDEX journeys_tenant_name_uq ON public.journeys (tenant_id, lower(name));
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journeys FORCE ROW LEVEL SECURITY;
CREATE POLICY journeys_app ON public.journeys FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY journeys_owner ON public.journeys FOR ALL TO owner USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journeys TO app;
GRANT SELECT, UPDATE ON public.journeys TO worker;
GRANT ALL ON public.journeys TO owner;

CREATE TABLE public.journey_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','stopped','failed')),
  step_index integer NOT NULL DEFAULT 0 CHECK (step_index >= 0),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  stop_reason text,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (journey_id, contact_id)
);
CREATE INDEX journey_runs_due_idx ON public.journey_runs (next_run_at) WHERE status = 'active';
CREATE INDEX journey_runs_contact_idx ON public.journey_runs (tenant_id, contact_id) WHERE status = 'active';
ALTER TABLE public.journey_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY journey_runs_app ON public.journey_runs FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY journey_runs_owner ON public.journey_runs FOR ALL TO owner USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.journey_runs TO app;
GRANT SELECT, INSERT, UPDATE ON public.journey_runs TO worker;
GRANT ALL ON public.journey_runs TO owner;

-- One message per run and step, ever. A crash and retry can never send a step twice (NULLs are distinct, so ordinary messages are unaffected).
ALTER TABLE public.messages ADD COLUMN journey_run_id uuid REFERENCES public.journey_runs(id) ON DELETE SET NULL, ADD COLUMN journey_step integer;
CREATE UNIQUE INDEX messages_journey_step_uq ON public.messages (journey_run_id, journey_step);

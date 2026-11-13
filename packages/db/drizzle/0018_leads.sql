-- Lead engine (P1). Append-only.
-- A "source" is one way leads arrive (a webhook URL, a form, an ad connector). A lead is a person who asked to be contacted.
-- A lead is NOT marketing consent: consent is decided per source and written to the contact's consent history.

CREATE TABLE public.lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'webhook',
  name text NOT NULL,
  public_id text NOT NULL UNIQUE,
  secret_hash text,
  secret_hint text,
  enabled boolean NOT NULL DEFAULT true,
  -- none: lead is reachable for replies only (consent unknown). field: payload must carry a truthy consent field.
  -- attested: the owner confirmed the form shows a clear WhatsApp opt-in; recorded with who and when.
  consent_mode text NOT NULL DEFAULT 'none',
  attested_by text,
  attested_at timestamptz,
  default_tags text[] NOT NULL DEFAULT '{}',
  default_group_id uuid REFERENCES public.contact_groups(id) ON DELETE SET NULL,
  assign_user_ids text[] NOT NULL DEFAULT '{}',
  rr_cursor integer NOT NULL DEFAULT 0,
  field_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  lead_count integer NOT NULL DEFAULT 0,
  last_lead_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_sources_kind_chk CHECK (kind IN ('webhook','form','widget','import','manual','meta_lead_ads','ctwa','shopify','woocommerce','google_sheets','hubspot','zoho','indiamart','justdial','other')),
  CONSTRAINT lead_sources_consent_chk CHECK (consent_mode IN ('none','field','attested')),
  CONSTRAINT lead_sources_attest_chk CHECK (consent_mode <> 'attested' OR (attested_by IS NOT NULL AND attested_at IS NOT NULL))
);
CREATE INDEX lead_sources_tenant_idx ON public.lead_sources (tenant_id, created_at DESC);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'new',
  owner_user_id text,
  value_paise bigint NOT NULL DEFAULT 0,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  submissions integer NOT NULL DEFAULT 1,
  first_response_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_status_chk CHECK (status IN ('new','contacted','qualified','won','lost','junk')),
  CONSTRAINT leads_value_chk CHECK (value_paise >= 0)
);
CREATE INDEX leads_tenant_status_idx ON public.leads (tenant_id, status, created_at DESC);
CREATE INDEX leads_contact_idx ON public.leads (contact_id);
CREATE INDEX leads_owner_idx ON public.leads (tenant_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
-- At most one OPEN lead per person: a second submission adds to it instead of creating a duplicate.
CREATE UNIQUE INDEX leads_one_open_per_contact ON public.leads (tenant_id, contact_id) WHERE status IN ('new','contacted','qualified');

CREATE TABLE public.lead_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  kind text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_events_lead_idx ON public.lead_events (lead_id, id DESC);

-- What was refused and why, so a broken form or a full plan is visible instead of silent.
CREATE TABLE public.lead_rejects (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.lead_sources(id) ON DELETE CASCADE,
  reason text NOT NULL,
  detail text,
  sample jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_rejects_tenant_idx ON public.lead_rejects (tenant_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lead_sources','leads','lead_events','lead_rejects'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id())', t || '_all', t);
  END LOOP;
END $$;

REVOKE ALL ON public.lead_sources, public.leads, public.lead_events, public.lead_rejects FROM app;
-- The web role manages sources and works the pipeline; it never inserts leads (ingest is the worker's job, so a lead can only appear through a verified source).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_sources TO app;
GRANT SELECT, UPDATE (status, owner_user_id, value_paise, note, first_response_at, updated_at) ON public.leads TO app;
GRANT DELETE ON public.leads TO app;
GRANT SELECT, INSERT ON public.lead_events TO app;
GRANT SELECT, DELETE ON public.lead_rejects TO app;
GRANT USAGE, SELECT ON SEQUENCE public.lead_events_id_seq TO app;

GRANT SELECT, UPDATE ON public.lead_sources TO worker;
GRANT SELECT, INSERT, UPDATE ON public.leads TO worker;
GRANT SELECT, INSERT ON public.lead_events TO worker;
GRANT SELECT, INSERT ON public.lead_rejects TO worker;
GRANT USAGE, SELECT ON SEQUENCE public.lead_events_id_seq, public.lead_rejects_id_seq TO worker;
GRANT SELECT ON public.tenant_members, public.contact_groups TO worker;

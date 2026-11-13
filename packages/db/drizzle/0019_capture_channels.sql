-- Capture channels (P2). Append-only.

-- Platforms retry pushes. A stable id from the platform (IndiaMART UNIQUE_QUERY_ID, Facebook leadgen_id, a Zapier zap id...) makes a retry a no-op.
CREATE TABLE public.lead_external_ids (
  source_id uuid NOT NULL REFERENCES public.lead_sources(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, external_id)
);
ALTER TABLE public.lead_external_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_external_ids FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_external_ids_all ON public.lead_external_ids FOR SELECT TO app USING (tenant_id = public.current_tenant_id());
REVOKE ALL ON public.lead_external_ids FROM app;
GRANT SELECT ON public.lead_external_ids TO app;
GRANT SELECT, INSERT ON public.lead_external_ids TO worker;

-- Click-to-WhatsApp ad attribution lives on the conversation (spec A.3.1).
ALTER TABLE public.conversations ADD COLUMN ctwa_clid text, ADD COLUMN referral jsonb;
-- Each workspace has at most one system-owned ad source, created by the worker the first time an ad click arrives.
CREATE UNIQUE INDEX lead_sources_one_ctwa ON public.lead_sources (tenant_id) WHERE kind = 'ctwa';
GRANT INSERT ON public.lead_sources TO worker;
GRANT UPDATE (ctwa_clid, referral) ON public.conversations TO worker;

-- Hosted lead forms: a public page at /f/<slug> that feeds a normal lead source.
CREATE TABLE public.lead_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.lead_sources(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  intro text,
  button_text text NOT NULL DEFAULT 'Send',
  thank_you text NOT NULL DEFAULT 'Thank you! We will message you on WhatsApp shortly.',
  ask_email boolean NOT NULL DEFAULT false,
  extra_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  consent_text text,
  accent text NOT NULL DEFAULT '#10b981',
  enabled boolean NOT NULL DEFAULT true,
  view_count integer NOT NULL DEFAULT 0,
  submit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_forms_slug_chk CHECK (slug ~ '^[a-z0-9][a-z0-9-]{5,40}$'),
  CONSTRAINT lead_forms_accent_chk CHECK (accent ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT lead_forms_title_chk CHECK (char_length(title) BETWEEN 2 AND 80),
  CONSTRAINT lead_forms_extra_chk CHECK (jsonb_typeof(extra_fields) = 'array' AND jsonb_array_length(extra_fields) <= 6)
);
CREATE INDEX lead_forms_tenant_idx ON public.lead_forms (tenant_id, created_at DESC);
ALTER TABLE public.lead_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_forms FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_forms_all ON public.lead_forms FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
REVOKE ALL ON public.lead_forms FROM app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_forms TO app;
GRANT SELECT, UPDATE (submit_count, view_count) ON public.lead_forms TO worker;

-- What an anonymous visitor may see of a form. No tenant context exists for a visitor, so this is the only door, and it returns only public fields.
CREATE OR REPLACE FUNCTION public.public_form(p_slug text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('title', f.title, 'intro', f.intro, 'buttonText', f.button_text, 'thankYou', f.thank_you, 'askEmail', f.ask_email,
    'extraFields', f.extra_fields, 'consentText', f.consent_text, 'accent', f.accent, 'business', t.name)
  FROM public.lead_forms f JOIN public.tenants t ON t.id = f.tenant_id WHERE f.slug = p_slug AND f.enabled
$$;
REVOKE ALL ON FUNCTION public.public_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_form(text) TO app;

-- Counts a page view without needing a tenant context. Cheap and lossy on purpose.
CREATE OR REPLACE FUNCTION public.count_form_view(p_slug text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.lead_forms SET view_count = view_count + 1 WHERE slug = p_slug AND enabled
$$;
REVOKE ALL ON FUNCTION public.count_form_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_form_view(text) TO app;

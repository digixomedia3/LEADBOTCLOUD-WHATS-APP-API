-- Template media headers (P4). Append-only.
-- The file a template shows at the top (image, video or PDF). The bytes live here for now (local storage driver); `meta_handle` is the
-- Resumable Upload handle Meta wants when the template is created, and `media_ids` caches the per-number media id used when sending.
-- An asset is uploaded before its template is saved, so template_id may be null for a short while; the worker removes unattached ones after a day.

UPDATE public.templates SET header_type = CASE WHEN header_text IS NOT NULL AND header_text <> '' THEN 'text' ELSE 'none' END WHERE header_type NOT IN ('text','image','video','document');
ALTER TABLE public.templates ADD CONSTRAINT templates_header_type_chk CHECK (header_type IN ('none','text','image','video','document'));

CREATE TABLE public.template_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.templates(id) ON DELETE CASCADE,
  kind text NOT NULL,
  mime text NOT NULL,
  file_name text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  data bytea NOT NULL,
  meta_handle text,
  meta_handle_at timestamptz,
  media_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_assets_kind_chk CHECK (kind IN ('image','video','document')),
  CONSTRAINT template_assets_size_chk CHECK (size_bytes > 0 AND size_bytes <= 16777216 AND octet_length(data) = size_bytes),
  CONSTRAINT template_assets_mime_chk CHECK (mime IN ('image/jpeg','image/png','video/mp4','application/pdf'))
);
CREATE UNIQUE INDEX template_assets_template_uq ON public.template_assets (template_id) WHERE template_id IS NOT NULL;
CREATE INDEX template_assets_tenant_idx ON public.template_assets (tenant_id, created_at DESC);
ALTER TABLE public.template_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY template_assets_all ON public.template_assets FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY template_assets_owner ON public.template_assets FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.template_assets FROM app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_assets TO app;
GRANT SELECT, UPDATE, DELETE ON public.template_assets TO worker;

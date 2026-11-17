-- Files the team sends to a customer from the chat (P8). Append-only.
-- One row per outgoing photo, video or PDF. The bytes live here (same local storage choice as template headers); `media_ids` caches the id Meta gives
-- when the worker uploads the file for a sending number, so a retry never uploads twice.
CREATE TABLE public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  kind text NOT NULL,
  mime text NOT NULL,
  file_name text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  data bytea NOT NULL,
  media_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_attachments_kind_chk CHECK (kind IN ('image','video','document')),
  CONSTRAINT message_attachments_mime_chk CHECK (mime IN ('image/jpeg','image/png','video/mp4','application/pdf')),
  CONSTRAINT message_attachments_size_chk CHECK (size_bytes > 0 AND size_bytes <= 16777216 AND octet_length(data) = size_bytes)
);
CREATE UNIQUE INDEX message_attachments_message_uq ON public.message_attachments (message_id);
CREATE INDEX message_attachments_tenant_idx ON public.message_attachments (tenant_id, created_at DESC);
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY message_attachments_all ON public.message_attachments FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY message_attachments_owner ON public.message_attachments FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.message_attachments FROM app;
-- The web role adds the file together with its message and reads it back for the chat. It can never change or delete one afterwards.
GRANT SELECT, INSERT ON public.message_attachments TO app;
GRANT SELECT, UPDATE (media_ids) ON public.message_attachments TO worker;

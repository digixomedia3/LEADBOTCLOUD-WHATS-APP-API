-- Inbound media (P8). Append-only.
-- When a customer sends a picture, voice note, video, document or sticker, Meta only gives us a media id, and the download link works for a few
-- minutes. The worker fetches the file and keeps it here so the chat can show it later. `state` says where that stands, so the chat can say
-- "still downloading" or "could not load" instead of showing nothing.
CREATE TABLE public.inbound_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  kind text NOT NULL,
  meta_media_id text NOT NULL,
  mime text,
  file_name text,
  caption text,
  size_bytes integer,
  data bytea,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_try_at timestamptz NOT NULL DEFAULT now(),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  stored_at timestamptz,
  CONSTRAINT inbound_media_kind_chk CHECK (kind IN ('image','audio','video','document','sticker')),
  CONSTRAINT inbound_media_state_chk CHECK (state IN ('pending','stored','failed','too_large')),
  CONSTRAINT inbound_media_data_chk CHECK ((state = 'stored') = (data IS NOT NULL)),
  CONSTRAINT inbound_media_size_chk CHECK (size_bytes IS NULL OR size_bytes >= 0)
);
CREATE UNIQUE INDEX inbound_media_message_uq ON public.inbound_media (message_id);
CREATE INDEX inbound_media_due_idx ON public.inbound_media (next_try_at) WHERE state = 'pending';
CREATE INDEX inbound_media_tenant_idx ON public.inbound_media (tenant_id, created_at DESC);
ALTER TABLE public.inbound_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_media FORCE ROW LEVEL SECURITY;
CREATE POLICY inbound_media_all ON public.inbound_media FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY inbound_media_owner ON public.inbound_media FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.inbound_media FROM app;
-- The web side only reads (to show and serve the file). Only the worker writes.
GRANT SELECT ON public.inbound_media TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_media TO worker;

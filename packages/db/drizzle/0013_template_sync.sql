-- Template submission + sync with Meta (spec 7.1). Append-only.
-- The web role cannot read the WhatsApp token, so it only RECORDS intent here; the worker (which can) talks to Meta.
ALTER TABLE public.templates
  ADD COLUMN submit_requested_at timestamptz,
  ADD COLUMN submit_error text,
  ADD COLUMN submit_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.templates DROP CONSTRAINT IF EXISTS templates_status_chk;
ALTER TABLE public.templates ADD CONSTRAINT templates_status_chk CHECK (status IN ('draft','pending','approved','rejected','paused','disabled','deleting'));

ALTER TABLE public.meta_accounts ADD COLUMN templates_synced_at timestamptz;

-- Worker work queues: formats waiting to be sent to Meta, and formats waiting to be removed there.
CREATE INDEX templates_submit_idx ON public.templates (submit_requested_at) WHERE status = 'pending' AND meta_template_id IS NULL;
CREATE INDEX templates_deleting_idx ON public.templates (updated_at) WHERE status = 'deleting';

-- Imported formats come from WhatsApp Manager and have no author in our system.
GRANT INSERT, UPDATE, DELETE ON public.templates TO worker;

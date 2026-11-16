-- Quiet hours and send speed (P5). Append-only.
-- Quiet hours are per workspace and hold only promotional messages. Speed is per campaign.
ALTER TABLE public.tenants
  ADD COLUMN quiet_hours_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN quiet_start_hour smallint NOT NULL DEFAULT 21,
  ADD COLUMN quiet_end_hour smallint NOT NULL DEFAULT 9;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_quiet_chk CHECK (
  quiet_start_hour BETWEEN 0 AND 23 AND quiet_end_hour BETWEEN 0 AND 23 AND quiet_start_hour <> quiet_end_hour
  AND (CASE WHEN quiet_start_hour > quiet_end_hour THEN 24 - quiet_start_hour + quiet_end_hour ELSE quiet_end_hour - quiet_start_hour END) <= 16);
GRANT UPDATE (quiet_hours_enabled, quiet_start_hour, quiet_end_hour) ON public.tenants TO app;

ALTER TABLE public.campaigns ADD COLUMN send_per_minute integer;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_speed_chk CHECK (send_per_minute IS NULL OR (send_per_minute BETWEEN 1 AND 6000));

-- The earliest moment a queued message may be sent. Set at launch (speed) and by the sender (quiet hours). NULL = any time.
ALTER TABLE public.messages ADD COLUMN not_before timestamptz;
CREATE INDEX messages_queued_due_idx ON public.messages (not_before) WHERE status = 'queued' AND wamid IS NULL;

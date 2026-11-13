-- Connector events: a lease so two workers can never process the same event at once. Append-only.
ALTER TABLE public.connector_events ADD COLUMN claimed_at timestamptz;

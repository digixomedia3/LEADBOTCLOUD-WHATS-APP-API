-- A/B "test first, then send the winner to everyone else". Append-only.
-- With ab_hold_rest on, only ab_test_pct percent of the audience gets the two versions at launch (split half and half). Everyone else is kept as a 'held'
-- recipient: no message exists for them yet. Later the owner picks a version and the worker sends it to the held people, checking permission again at that moment.
ALTER TABLE public.campaigns
  ADD COLUMN ab_hold_rest boolean NOT NULL DEFAULT false,
  ADD COLUMN ab_test_pct integer,
  ADD COLUMN ab_release_version text,
  ADD COLUMN ab_release_requested_at timestamptz,
  ADD COLUMN ab_release_requested_by text,
  ADD COLUMN ab_released_at timestamptz,
  ADD COLUMN ab_release_error text;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_ab_hold_chk CHECK (
  (ab_hold_rest = false AND ab_test_pct IS NULL AND ab_release_version IS NULL AND ab_release_requested_at IS NULL AND ab_released_at IS NULL)
  OR (ab_hold_rest = true AND ab_template_id IS NOT NULL AND ab_test_pct BETWEEN 10 AND 50 AND ab_percent_b = 50)
);
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_ab_release_version_chk CHECK (ab_release_version IS NULL OR ab_release_version IN ('a','b'));

ALTER TABLE public.campaign_recipients DROP CONSTRAINT cr_state_chk;
ALTER TABLE public.campaign_recipients ADD CONSTRAINT cr_state_chk CHECK (state IN
  ('queued','sent','delivered','read','replied','failed','skipped','capped','retry_wait','held'));
-- Which part of a test a person belongs to. 'test' people got version A or B and are what the report compares. 'rest' people were held back and later get the chosen version; they are never part of the comparison.
ALTER TABLE public.campaign_recipients ADD COLUMN phase text NOT NULL DEFAULT 'test' CHECK (phase IN ('test','rest'));
-- Waiting for release: the worker looks these up by campaign.
CREATE INDEX campaigns_ab_release_idx ON public.campaigns (ab_release_requested_at) WHERE ab_release_version IS NOT NULL AND ab_released_at IS NULL;

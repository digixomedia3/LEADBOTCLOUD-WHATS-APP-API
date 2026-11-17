-- A/B tests on campaigns (P5). Append-only.
-- A campaign may carry a second template (version B) and the share of people who get it. Everyone else gets the campaign's own template (version A).
-- Each recipient records which version they got, fixed at launch, so the report compares the two groups fairly.
ALTER TABLE public.campaigns
  ADD COLUMN ab_template_id uuid REFERENCES public.templates(id) ON DELETE RESTRICT,
  ADD COLUMN ab_var_map jsonb,
  ADD COLUMN ab_percent_b integer;
-- All three or none. B is never the same template as A. The share is 10 to 90 so both groups can be measured.
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_ab_chk CHECK (
  (ab_template_id IS NULL AND ab_var_map IS NULL AND ab_percent_b IS NULL)
  OR (ab_template_id IS NOT NULL AND ab_var_map IS NOT NULL AND jsonb_typeof(ab_var_map) = 'array' AND ab_percent_b BETWEEN 10 AND 90 AND ab_template_id <> template_id AND repeat = 'none')
);

ALTER TABLE public.campaign_recipients ADD COLUMN version text NOT NULL DEFAULT 'a' CHECK (version IN ('a','b'));
CREATE INDEX campaign_recipients_version_idx ON public.campaign_recipients (campaign_id, version);

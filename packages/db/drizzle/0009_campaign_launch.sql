-- Campaign variable mapping + launcher support (spec 4.5/4.6). Append-only.
ALTER TABLE public.campaigns ADD COLUMN var_map jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.campaigns ADD COLUMN launched_at timestamptz;
CREATE INDEX campaigns_due_idx ON public.campaigns (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX campaigns_open_idx ON public.campaigns (status) WHERE status IN ('running','completed');
GRANT SELECT, INSERT, UPDATE ON public.campaigns, public.campaign_recipients, public.messages, public.conversations, public.contacts TO worker;
GRANT SELECT, INSERT ON public.contact_consent_events TO worker;
GRANT UPDATE ON public.templates, public.tenants TO worker;
GRANT SELECT ON public.templates, public.tenants, public.contact_groups, public.contact_group_members, public.automation_rules TO worker;
GRANT UPDATE ON public.automation_rules TO worker;

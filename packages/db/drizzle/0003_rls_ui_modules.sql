-- RLS for the UI modules. Every table is tenant-scoped and forced, like contacts.

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates FORCE ROW LEVEL SECURITY;
CREATE POLICY templates_all ON public.templates FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY campaigns_all ON public.campaigns FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY campaign_recipients_all ON public.campaign_recipients FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY conversations_all ON public.conversations FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_all ON public.messages FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_replies FORCE ROW LEVEL SECURITY;
CREATE POLICY quick_replies_all ON public.quick_replies FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_rules_all ON public.automation_rules FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renewals FORCE ROW LEVEL SECURITY;
CREATE POLICY renewals_all ON public.renewals FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

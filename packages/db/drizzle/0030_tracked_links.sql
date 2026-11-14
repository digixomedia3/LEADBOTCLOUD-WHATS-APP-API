-- Tracked links (P5). Append-only.
-- Every person in a campaign gets their own short code. Their website button goes to /r/<code>, which records the click and sends them on.
-- The destination is chosen once per campaign by an owner/admin; the code can never change where a link goes.
ALTER TABLE public.campaigns ADD COLUMN link_url text;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_link_url_chk CHECK (link_url IS NULL OR (link_url ~ '^https://[^\s@/]+(/[^\s]*)?$' AND char_length(link_url) <= 2000));

CREATE TABLE public.tracked_links (
  code text PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9]{12}$'),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_recipient_id uuid NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_recipient_id)
);
CREATE INDEX tracked_links_campaign_idx ON public.tracked_links (campaign_id);
ALTER TABLE public.tracked_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tracked_links_select ON public.tracked_links FOR SELECT TO app USING (tenant_id = public.current_tenant_id());
CREATE POLICY tracked_links_owner ON public.tracked_links FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.tracked_links FROM app;
GRANT SELECT ON public.tracked_links TO app;
GRANT SELECT, INSERT ON public.tracked_links TO worker;
GRANT SELECT, INSERT ON public.tracked_links TO owner;

-- One row per human click. No address, no browser string: only when, and whether it looked like a robot (link previews, crawlers).
CREATE TABLE public.link_clicks (
  id bigserial PRIMARY KEY,
  code text NOT NULL REFERENCES public.tracked_links(code) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  is_bot boolean NOT NULL DEFAULT false
);
CREATE INDEX link_clicks_campaign_idx ON public.link_clicks (campaign_id, is_bot);
CREATE INDEX link_clicks_code_idx ON public.link_clicks (code);
ALTER TABLE public.link_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_clicks FORCE ROW LEVEL SECURITY;
CREATE POLICY link_clicks_select ON public.link_clicks FOR SELECT TO app USING (tenant_id = public.current_tenant_id());
CREATE POLICY link_clicks_owner ON public.link_clicks FOR ALL TO owner USING (true) WITH CHECK (true);
REVOKE ALL ON public.link_clicks FROM app;
GRANT SELECT ON public.link_clicks TO app;
GRANT SELECT, INSERT ON public.link_clicks TO owner;
GRANT USAGE, SELECT ON SEQUENCE public.link_clicks_id_seq TO owner;

-- The public redirect asks this before any workspace is known. It records the click and returns where to go, or nothing for an unknown code.
CREATE OR REPLACE FUNCTION public.follow_link(p_code text, p_bot boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_url text; v_tenant uuid; v_campaign uuid;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9]{12}$' THEN RETURN NULL; END IF;
  SELECT c.link_url, l.tenant_id, l.campaign_id INTO v_url, v_tenant, v_campaign
    FROM public.tracked_links l
    JOIN public.campaigns c ON c.id = l.campaign_id AND c.tenant_id = l.tenant_id
    JOIN public.tenants t ON t.id = l.tenant_id AND t.status NOT IN ('suspended', 'offboarded')
   WHERE l.code = p_code;
  IF v_url IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.link_clicks (code, tenant_id, campaign_id, is_bot) VALUES (p_code, v_tenant, v_campaign, coalesce(p_bot, true));
  RETURN v_url;
END $$;
REVOKE ALL ON FUNCTION public.follow_link(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.follow_link(text, boolean) TO app;

-- Fix for 0042 (found by scanning the whole database after a delete). Append-only.
-- campaign_recipients and webhook_events have FORCED row security, and the owner role only has a read policy there, so the erase trigger's UPDATEs
-- matched nothing and silently left the number behind. These policies let the owner UPDATE, but only while the erase function is running
-- (it sets a flag for its own transaction), so no other owner-role query gains any new ability.
CREATE OR REPLACE FUNCTION public.erase_contact_residue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE digits text := regexp_replace(OLD.phone_e164, '[^0-9]', '', 'g');
BEGIN
  PERFORM set_config('lbc.erasing', 'on', true);   -- true = this transaction only
  UPDATE public.campaign_recipients SET phone_e164 = 'erased' WHERE tenant_id = OLD.tenant_id AND (contact_id = OLD.id OR phone_e164 = OLD.phone_e164);
  IF length(digits) >= 8 THEN
    UPDATE public.webhook_events w SET payload = jsonb_build_object('erased', true, 'kind', w.payload->>'kind')
      WHERE w.phone_number_id IN (SELECT p.phone_number_id FROM public.phone_numbers p WHERE p.tenant_id = OLD.tenant_id)
        AND w.payload::text LIKE '%' || digits || '%';
  END IF;
  PERFORM set_config('lbc.erasing', 'off', true);
  RETURN OLD;
END $$;
CREATE POLICY erase_residue_recipients ON public.campaign_recipients FOR UPDATE TO owner USING (current_setting('lbc.erasing', true) = 'on') WITH CHECK (current_setting('lbc.erasing', true) = 'on');
CREATE POLICY erase_residue_webhooks ON public.webhook_events FOR UPDATE TO owner USING (current_setting('lbc.erasing', true) = 'on') WITH CHECK (current_setting('lbc.erasing', true) = 'on');
GRANT UPDATE (phone_e164) ON public.campaign_recipients TO owner;
GRANT UPDATE (payload) ON public.webhook_events TO owner;

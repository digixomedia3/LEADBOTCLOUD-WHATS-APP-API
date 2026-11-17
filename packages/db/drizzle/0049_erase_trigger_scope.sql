-- Fix for 0048, which skipped ALL erasing when the whole workspace is being deleted. Only the recipient-row blanking must be skipped then (its rows are removed by
-- the same cascade, and updating them re-checks a foreign key to a workspace that is already gone). Stored webhooks have no such link and are NOT removed by that
-- cascade, so their payloads are still scrubbed. Append-only.
CREATE OR REPLACE FUNCTION public.erase_contact_residue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE digits text := regexp_replace(OLD.phone_e164, '[^0-9]', '', 'g'); alive boolean := EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id);
BEGIN
  PERFORM set_config('lbc.erasing', 'on', true);
  IF alive THEN
    UPDATE public.campaign_recipients SET phone_e164 = 'erased' WHERE tenant_id = OLD.tenant_id AND (contact_id = OLD.id OR phone_e164 = OLD.phone_e164);
  END IF;
  IF length(digits) >= 8 THEN
    UPDATE public.webhook_events w SET payload = jsonb_build_object('erased', true, 'kind', w.payload->>'kind')
      WHERE w.phone_number_id IN (SELECT p.phone_number_id FROM public.phone_numbers p WHERE p.tenant_id = OLD.tenant_id)
        AND w.payload::text LIKE '%' || digits || '%';
  END IF;
  PERFORM set_config('lbc.erasing', 'off', true);
  RETURN OLD;
END $$;

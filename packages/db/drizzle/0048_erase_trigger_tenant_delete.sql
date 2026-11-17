-- Fix for 0042/0043. Append-only.
-- Deleting a whole workspace cascades to its contacts; at that moment the workspace row is already gone, so the erase trigger's UPDATE of the recipient
-- rows made the database re-check a foreign key to a workspace that no longer exists, and the delete failed. The blanking is pointless in that case
-- (the recipient rows are being deleted by the same cascade), so the trigger now does nothing when the workspace itself is going away.
CREATE OR REPLACE FUNCTION public.erase_contact_residue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE digits text := regexp_replace(OLD.phone_e164, '[^0-9]', '', 'g');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
  PERFORM set_config('lbc.erasing', 'on', true);
  UPDATE public.campaign_recipients SET phone_e164 = 'erased' WHERE tenant_id = OLD.tenant_id AND (contact_id = OLD.id OR phone_e164 = OLD.phone_e164);
  IF length(digits) >= 8 THEN
    UPDATE public.webhook_events w SET payload = jsonb_build_object('erased', true, 'kind', w.payload->>'kind')
      WHERE w.phone_number_id IN (SELECT p.phone_number_id FROM public.phone_numbers p WHERE p.tenant_id = OLD.tenant_id)
        AND w.payload::text LIKE '%' || digits || '%';
  END IF;
  PERFORM set_config('lbc.erasing', 'off', true);
  RETURN OLD;
END $$;

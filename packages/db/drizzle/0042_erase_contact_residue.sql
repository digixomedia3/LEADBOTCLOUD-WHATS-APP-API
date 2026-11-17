-- Erasing a contact must erase their number everywhere (P8, DPDP "right to erasure"). Append-only.
-- Deleting a contact already cascades to chats, messages, files, leads, journeys and consent history. Two places kept a copy of the number:
--   campaign_recipients.phone_e164 (the row is kept for the campaign's counts, so only the number is blanked)
--   webhook_events.payload         (the raw message Meta sent us; the payload is replaced, only the kind is kept)
-- A trigger does it, so it holds however the contact is deleted (screen, bulk delete, API, workspace removal), and the web role (which cannot touch
-- webhook_events) cannot forget to. Runs with the owner's rights, but only ever for the one contact being deleted.
CREATE OR REPLACE FUNCTION public.erase_contact_residue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE digits text := regexp_replace(OLD.phone_e164, '[^0-9]', '', 'g');
BEGIN
  UPDATE public.campaign_recipients SET phone_e164 = 'erased' WHERE tenant_id = OLD.tenant_id AND (contact_id = OLD.id OR phone_e164 = OLD.phone_e164);
  IF length(digits) >= 8 THEN
    UPDATE public.webhook_events w SET payload = jsonb_build_object('erased', true, 'kind', w.payload->>'kind')
      WHERE w.phone_number_id IN (SELECT p.phone_number_id FROM public.phone_numbers p WHERE p.tenant_id = OLD.tenant_id)
        AND w.payload::text LIKE '%' || digits || '%';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.erase_contact_residue() FROM PUBLIC;
CREATE TRIGGER contacts_erase_residue BEFORE DELETE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.erase_contact_residue();

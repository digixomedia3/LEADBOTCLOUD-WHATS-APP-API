-- public_form() and count_form_view() are SECURITY DEFINER functions owned by "owner". With FORCE ROW LEVEL SECURITY and no policy for that role,
-- they saw no rows, so every public form page would have been a 404. Give the owner role exactly what those two functions need.
CREATE POLICY lead_forms_owner ON public.lead_forms FOR ALL TO owner USING (true) WITH CHECK (true);

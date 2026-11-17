-- Second fix for 0042/0043. Append-only.
-- campaign_recipients gave the owner role no read access, so the erase trigger's UPDATE could not see the rows it had to blank.
-- Read access is granted only while the erase function runs (same per-transaction flag), so nothing else in the owner role can read this table.
CREATE POLICY erase_residue_recipients_read ON public.campaign_recipients FOR SELECT TO owner USING (current_setting('lbc.erasing', true) = 'on');

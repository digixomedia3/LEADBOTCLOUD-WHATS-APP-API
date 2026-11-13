-- Fix for 0010: disconnect_meta() ran its UPDATE on campaigns as the owner role, but FORCE RLS also needs a SELECT policy for the rows the
-- UPDATE ... WHERE reads. With only an UPDATE policy the statement matched 0 rows and silently paused nothing.
-- Narrow on purpose: the owner role may read and update campaigns (only the definer functions run as owner).
DROP POLICY IF EXISTS campaigns_owner_pause ON public.campaigns;
CREATE POLICY campaigns_owner_all ON public.campaigns FOR ALL TO owner USING (true) WITH CHECK (true);

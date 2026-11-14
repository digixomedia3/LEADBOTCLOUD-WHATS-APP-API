-- resolve_api_key() runs as the table owner and must see a key BEFORE any workspace is known.
-- Every other tenant table gives its owner role a catch-all policy for the same reason; api_keys was missing it, so a valid key resolved to nothing.
-- The `app` role still sees only its own workspace's keys (api_keys_all), and can call the lookup function only with a hash it already holds.
CREATE POLICY api_keys_owner ON public.api_keys FOR ALL TO owner USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE (last_used_at) ON public.api_keys TO owner;

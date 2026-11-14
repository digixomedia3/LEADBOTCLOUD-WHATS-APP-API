-- API keys for agents and integrations (P8, pulled forward). Append-only.
-- A key belongs to one workspace and acts with the permissions of the person who created it, capped by its scopes.
-- Only a SHA-256 of the key is stored; the key itself is shown once at creation and cannot be recovered.
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  prefix text NOT NULL CHECK (prefix ~ '^lbc_[a-f0-9]{8}$'),
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 8 AND scopes <@ ARRAY['contacts:read','contacts:write','templates:read','campaigns:read','campaigns:write','campaigns:send']::text[]),
  -- Most one bulk send started with this key may cost, in paise incl. GST. A key can never start a send above this.
  send_cap_paise integer NOT NULL DEFAULT 50000 CHECK (send_cap_paise BETWEEN 0 AND 100000000),
  created_by text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX api_keys_tenant_idx ON public.api_keys (tenant_id, created_at DESC);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY api_keys_all ON public.api_keys FOR ALL TO app USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
REVOKE ALL ON public.api_keys FROM app;
GRANT SELECT, INSERT ON public.api_keys TO app;
-- The panel may only rename a key or revoke it. It can never widen scopes, raise the cap or un-revoke.
GRANT UPDATE (name, revoked_at) ON public.api_keys TO app;
CREATE OR REPLACE FUNCTION public.api_keys_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION 'A revoked key cannot be restored' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER api_keys_guard BEFORE UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.api_keys_guard();

-- Looks a key up BEFORE any workspace is known (that is the point of the key), and records that it was used.
-- Returns nothing when the key is unknown, revoked, expired, its workspace is not active, or its creator is no longer an owner/admin there.
CREATE OR REPLACE FUNCTION public.resolve_api_key(p_hash text)
RETURNS TABLE (key_id uuid, tenant_id uuid, tenant_name text, plan_id text, scopes text[], send_cap_paise integer, user_id text, user_name text, role text, prefix text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record;
BEGIN
  SELECT k.id, k.tenant_id, t.name AS tenant_name, t.plan_id, k.scopes, k.send_cap_paise, k.created_by, u.name AS user_name, m.role, k.prefix, k.last_used_at
    INTO r
    FROM public.api_keys k
    JOIN public.tenants t ON t.id = k.tenant_id AND t.status = 'active'
    JOIN public.tenant_members m ON m.tenant_id = k.tenant_id AND m.user_id = k.created_by AND m.role IN ('owner', 'admin')
    JOIN public."user" u ON u.id = k.created_by
   WHERE k.key_hash = p_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now());
  IF NOT FOUND THEN RETURN; END IF;
  IF r.last_used_at IS NULL OR r.last_used_at < now() - interval '1 minute' THEN UPDATE public.api_keys SET last_used_at = now() WHERE id = r.id; END IF;
  RETURN QUERY SELECT r.id, r.tenant_id, r.tenant_name, r.plan_id, r.scopes, r.send_cap_paise, r.created_by, r.user_name, r.role, r.prefix;
END $$;
REVOKE ALL ON FUNCTION public.resolve_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_api_key(text) TO app;

-- Invitation acceptance. A person who is not yet a member cannot read invitations under RLS, so acceptance
-- runs in a SECURITY DEFINER function that checks everything itself.
-- The caller must have set app.user_id to the verified signed-in user (same pattern as create_workspace).

CREATE OR REPLACE FUNCTION public.accept_invitation(p_user_id text, p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inv public.invitations%ROWTYPE;
  v_email text;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> coalesce(public.current_user_id(), '') THEN
    RAISE EXCEPTION 'accept_invitation: caller does not match user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM public.invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'invitation_used' USING ERRCODE = 'P0001'; END IF;
  IF v_inv.expires_at < now() THEN RAISE EXCEPTION 'invitation_expired' USING ERRCODE = 'P0001'; END IF;
  SELECT lower(email) INTO v_email FROM public."user" WHERE id = p_user_id;
  IF v_email IS NULL THEN RAISE EXCEPTION 'accept_invitation: unknown user' USING ERRCODE = '42501'; END IF;
  IF v_inv.email IS NULL OR lower(v_inv.email) <> v_email THEN
    RAISE EXCEPTION 'invitation_wrong_email' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
    VALUES (v_inv.tenant_id, p_user_id, v_inv.role)
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  UPDATE public.invitations SET accepted_at = now(), updated_at = now() WHERE id = v_inv.id;
  RETURN v_inv.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text, text) TO app;

-- The function runs as the owner role, which is bound by FORCE RLS, so it needs narrow policies on what it touches.
CREATE POLICY invitations_owner ON public.invitations FOR ALL TO owner USING (true) WITH CHECK (true);

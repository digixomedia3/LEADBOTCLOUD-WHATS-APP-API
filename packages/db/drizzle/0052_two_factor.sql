-- Two-factor sign-in (authenticator app codes and backup codes), through Better Auth's two-factor plugin. Append-only.
-- Like the other sign-in tables (user, session, account, verification) this one is global and holds no workspace data.
-- The secret and backup codes are encrypted by the plugin before they reach this table; they are never stored readable.

ALTER TABLE public."user" ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.two_factor (
  id text PRIMARY KEY,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  verified boolean NOT NULL DEFAULT true,
  failed_verification_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);
CREATE INDEX two_factor_user_idx ON public.two_factor (user_id);
CREATE INDEX two_factor_secret_idx ON public.two_factor (secret);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.two_factor TO app;
-- The admin functions run as `owner` and only need to know WHETHER a person has it on, never the secret.
GRANT SELECT (id, user_id, verified) ON public.two_factor TO owner;
GRANT SELECT (two_factor_enabled) ON public."user" TO owner;
-- The user table was readable by the app role already; the new column follows. The worker never needs it.

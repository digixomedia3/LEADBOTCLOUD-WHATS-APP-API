-- Two-step sign-in secrets: who may read them. Append-only.
-- Default privileges had given the worker role full access to the new table, which would let any bug or breach in the background worker read every
-- authenticator secret and backup code. Only the sign-in code (app role) needs them; the worker needs nothing, and the admin functions only need to know
-- WHETHER someone has it on. The `owner` role owns the table, so it keeps its rights as owner, but the admin functions never select the secret columns
-- and the tests check that nothing they return contains one.
REVOKE ALL ON public.two_factor FROM worker;
REVOKE ALL ON public.two_factor FROM PUBLIC;
-- The worker also has no business reading or writing the flag on the user table beyond what it already had; nothing to change there.

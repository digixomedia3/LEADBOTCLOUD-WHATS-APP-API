-- The worker's workspace-closing job must know who is platform staff (never delete their sign-in) and may remove sign-ins that belong to no workspace. Append-only.
GRANT SELECT (user_id) ON public.platform_admins TO worker;

-- File retention (P8). Append-only.
-- Customer and team files are kept for a limited time, then the bytes are removed so the database does not grow without end.
-- A customer's file keeps its row with state 'expired' (the chat then says so); the message text always stays.
ALTER TABLE public.inbound_media DROP CONSTRAINT inbound_media_state_chk;
ALTER TABLE public.inbound_media ADD CONSTRAINT inbound_media_state_chk CHECK (state IN ('pending','stored','failed','too_large','expired'));
-- Files we sent are removed outright once old (the chat shows the message text only).
GRANT DELETE ON public.message_attachments TO worker;

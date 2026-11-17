-- Journeys, slice 2. Append-only.
-- A journey can now also start when a contact gets a tag ("tag_added"). The steps column already accepts any list, so only the trigger rule changes.
ALTER TABLE public.journeys DROP CONSTRAINT journeys_trigger_chk;
ALTER TABLE public.journeys ADD CONSTRAINT journeys_trigger_chk CHECK (
  jsonb_typeof(trigger) = 'object' AND trigger->>'type' IN ('manual','lead_created','tag_added')
  AND (trigger->>'type' <> 'tag_added' OR char_length(coalesce(trigger->>'tag', '')) BETWEEN 1 AND 40)
);
-- Finding people who carry a tag and are not in the journey yet must stay fast: contacts.tags already has a GIN index (contacts_tags_gin).

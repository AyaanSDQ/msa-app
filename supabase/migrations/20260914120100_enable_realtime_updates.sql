-- Enable Realtime (postgres_changes) on updates. No table was previously in
-- the supabase_realtime publication, so without this, client subscriptions
-- would silently never receive any events.
alter publication supabase_realtime add table public.updates;

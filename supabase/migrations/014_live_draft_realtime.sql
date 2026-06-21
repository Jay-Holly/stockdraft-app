-- Enable Realtime on draft feed (run after table exists)
-- Supabase Dashboard may still require enabling replication for league_draft_events.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_draft_events'
  ) then
    alter publication supabase_realtime add table public.league_draft_events;
  end if;
end $$;

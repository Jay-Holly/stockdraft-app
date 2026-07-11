-- Enable Realtime on live draft clock/state (run after table exists)
-- Supabase Dashboard may still require enabling replication for league_draft_state.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_draft_state'
  ) then
    alter publication supabase_realtime add table public.league_draft_state;
  end if;
end $$;

-- Allow human league commissioners to delete their own waiting leagues.

drop policy if exists "Owner can delete waiting human leagues" on public.leagues;
create policy "Owner can delete waiting human leagues"
  on public.leagues for delete
  to authenticated
  using (
    league_type = 'human'
    and owner_user_id = auth.uid()
    and status = 'waiting'
  );

-- Allow human league owners to delete their leagues at any status.
-- Related rows cascade from public.leagues (see migration 003+).

drop policy if exists "Owner can delete waiting human leagues" on public.leagues;
drop policy if exists "Owner can delete human leagues" on public.leagues;

create policy "Owner can delete human leagues"
  on public.leagues for delete
  to authenticated
  using (
    league_type = 'human'
    and owner_user_id = auth.uid()
  );

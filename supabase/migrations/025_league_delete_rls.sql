-- Allow AI league owners to delete their own leagues (cascades to related rows).

drop policy if exists "Owner can delete AI leagues" on public.leagues;
create policy "Owner can delete AI leagues"
  on public.leagues for delete
  to authenticated
  using (public.is_ai_league_owner(id));

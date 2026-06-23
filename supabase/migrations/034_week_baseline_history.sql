-- Historical week views: league-wide baseline reads + week-close snapshots

alter table public.roster_week_baselines
  add column if not exists value_at_close numeric;

drop policy if exists "Users view own week baselines" on public.roster_week_baselines;
create policy "League members view week baselines"
  on public.roster_week_baselines for select
  to authenticated
  using (public.is_league_member(league_id));

-- SDFL 2026 season: off-S&P-500 pick -> fallback player rank (504-600).
-- Separate table from sim_league_pick_injury_map (2024 beta mechanism) so
-- this has no effect on any existing league or code path.

create table if not exists public.sim_sdfl_2026_pick_injury_map (
  league_id uuid not null references public.leagues (id) on delete cascade,
  global_pick_number int not null check (global_pick_number >= 1),
  symbol text not null,
  injury_rank int not null check (injury_rank >= 504 and injury_rank <= 600),
  primary key (league_id, global_pick_number)
);

create index if not exists sim_sdfl_2026_pick_injury_map_league_symbol_idx
  on public.sim_sdfl_2026_pick_injury_map (league_id, symbol);

alter table public.sim_sdfl_2026_pick_injury_map enable row level security;

drop policy if exists "sim_sdfl_2026_pick_injury_map_read_members" on public.sim_sdfl_2026_pick_injury_map;
create policy "sim_sdfl_2026_pick_injury_map_read_members"
  on public.sim_sdfl_2026_pick_injury_map
  for select
  to authenticated
  using (public.is_league_member(league_id));

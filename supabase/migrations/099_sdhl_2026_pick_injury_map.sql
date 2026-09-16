-- SDHL 2026 season: off-S&P-500 pick -> fallback player rank (504-700).
-- Mirrors 078_sdfl_2026_pick_injury_map.sql but for NHL. Separate table from
-- sim_league_pick_injury_map (2024 beta cycle-of-100 mechanism, still used by
-- SDBA/SDLB) and from sim_sdfl_2026_pick_injury_map, so this has no effect on
-- any existing league or code path.
--
-- Range is 504-700 (not 504-600, unlike the SDFL table) to match this app's
-- NHL 2026 rankings, which are seeded 1-700 deep with no editorial/production
-- split -- see scripts/seed-sim-nhl-2026.mjs.

create table if not exists public.sim_sdhl_2026_pick_injury_map (
  league_id uuid not null references public.leagues (id) on delete cascade,
  global_pick_number int not null check (global_pick_number >= 1),
  symbol text not null,
  injury_rank int not null check (injury_rank >= 504 and injury_rank <= 700),
  primary key (league_id, global_pick_number)
);

create index if not exists sim_sdhl_2026_pick_injury_map_league_symbol_idx
  on public.sim_sdhl_2026_pick_injury_map (league_id, symbol);

alter table public.sim_sdhl_2026_pick_injury_map enable row level security;

drop policy if exists "sim_sdhl_2026_pick_injury_map_read_members" on public.sim_sdhl_2026_pick_injury_map;
create policy "sim_sdhl_2026_pick_injury_map_read_members"
  on public.sim_sdhl_2026_pick_injury_map
  for select
  to authenticated
  using (public.is_league_member(league_id));

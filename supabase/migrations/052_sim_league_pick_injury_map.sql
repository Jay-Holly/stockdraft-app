-- Per-league draft pick → editorial injury rank mapping (SDFL post-draft seed).

create table if not exists public.sim_league_pick_injury_map (
  league_id uuid not null references public.leagues (id) on delete cascade,
  global_pick_number int not null check (global_pick_number >= 1),
  symbol text not null,
  injury_rank int not null check (injury_rank >= 1 and injury_rank <= 100),
  cycle_group int not null check (cycle_group >= 0),
  week_offset int not null check (week_offset >= 0),
  primary key (league_id, global_pick_number)
);

create index if not exists sim_league_pick_injury_map_league_symbol_idx
  on public.sim_league_pick_injury_map (league_id, symbol);

alter table public.sim_league_pick_injury_map enable row level security;

drop policy if exists "sim_league_pick_injury_map_read_members" on public.sim_league_pick_injury_map;
create policy "sim_league_pick_injury_map_read_members"
  on public.sim_league_pick_injury_map
  for select
  to authenticated
  using (public.is_league_member(league_id));

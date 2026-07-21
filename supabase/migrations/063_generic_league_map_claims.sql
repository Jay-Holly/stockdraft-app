-- Generic team-slot claim tracking for sports-sim leagues that don't have
-- their own rich division/conference identity system (SDBA/SDHL/SDLB).
-- SDFL keeps using league_members.conference/division/division_slot
-- (see 054_sdfl_team_identity.sql) — untouched by this migration.

create table if not exists public.league_map_slot_claims (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sport text not null check (sport in ('nba', 'nhl', 'mlb')),
  slot_key text not null,
  city_label text not null,
  claimed_at timestamptz not null default now(),
  unique (league_id, slot_key),
  unique (league_id, user_id)
);

create index if not exists league_map_slot_claims_league_idx
  on public.league_map_slot_claims (league_id);

alter table public.league_map_slot_claims enable row level security;

drop policy if exists "league_map_slot_claims_read_members" on public.league_map_slot_claims;
create policy "league_map_slot_claims_read_members"
  on public.league_map_slot_claims
  for select
  to authenticated
  using (public.is_league_member(league_id));

drop policy if exists "league_map_slot_claims_insert_self" on public.league_map_slot_claims;
create policy "league_map_slot_claims_insert_self"
  on public.league_map_slot_claims
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_league_member(league_id));

drop policy if exists "league_map_slot_claims_delete_self" on public.league_map_slot_claims;
create policy "league_map_slot_claims_delete_self"
  on public.league_map_slot_claims
  for delete
  to authenticated
  using (user_id = auth.uid());

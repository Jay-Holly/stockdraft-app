-- Franchise identity fields on the generic map-slot claims (city/team name/
-- colors), bringing SDBA/SDHL/SDLB up to the same identity depth SDFL has
-- via league_members.franchise_* columns (054_sdfl_team_identity.sql).

alter table public.league_map_slot_claims
  add column if not exists franchise_city text,
  add column if not exists team_name text,
  add column if not exists franchise_colors jsonb,
  add column if not exists identity_completed_at timestamptz;

-- Phase 5: Free AI League — bot profiles, matchups, scoring

-- Allow system bot profiles without auth.users rows
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles add column if not exists is_bot boolean not null default false;

insert into public.profiles (id, username, team_name, avatar_color, is_bot) values
  ('a1000001-0001-4001-8001-000000000001', 'the_analyst', 'The Analyst', 'blue', true),
  ('a1000001-0001-4001-8001-000000000002', 'the_gambler', 'The Gambler', 'red', true),
  ('a1000001-0001-4001-8001-000000000003', 'crypto_king', 'The Crypto King', 'gold', true)
on conflict (id) do update
  set is_bot = true,
      username = excluded.username,
      team_name = excluded.team_name,
      avatar_color = excluded.avatar_color;

alter table public.leagues add column if not exists league_type text not null default 'solo'
  check (league_type in ('solo', 'ai'));
alter table public.leagues add column if not exists status text not null default 'drafting'
  check (status in ('drafting', 'active', 'complete'));
alter table public.leagues add column if not exists owner_user_id uuid references public.profiles(id) on delete set null;

alter table public.league_members add column if not exists bot_personality text
  check (bot_personality is null or bot_personality in ('analyst', 'gambler', 'crypto_king'));
alter table public.league_members add column if not exists display_name text;

create index if not exists leagues_owner_user_id_idx on public.leagues (owner_user_id);
create index if not exists leagues_type_status_idx on public.leagues (league_type, status);
create index if not exists league_members_bot_personality_idx on public.league_members (bot_personality);

create table if not exists public.league_matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  week_number int not null check (week_number >= 1),
  opponent_bot_id uuid not null references public.profiles(id) on delete cascade,
  opponent_name text not null,
  human_score_pct numeric,
  opponent_score_pct numeric,
  winner text check (winner is null or winner in ('human', 'opponent', 'tie')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'complete')),
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  unique (league_id, week_number)
);

create table if not exists public.league_standings (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  wins int not null default 0 check (wins >= 0),
  losses int not null default 0 check (losses >= 0),
  current_week int not null default 1 check (current_week >= 1),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index if not exists league_matchups_league_id_idx on public.league_matchups (league_id);

alter table public.league_matchups enable row level security;
alter table public.league_standings enable row level security;

drop policy if exists "Members can view league matchups" on public.league_matchups;
create policy "Members can view league matchups"
  on public.league_matchups for select
  using (public.is_league_member(league_id));

drop policy if exists "Members can view league standings" on public.league_standings;
create policy "Members can view league standings"
  on public.league_standings for select
  using (public.is_league_member(league_id));

-- League owner can insert/update matchups and standings for their AI league
drop policy if exists "Owner manages AI league matchups" on public.league_matchups;
create policy "Owner manages AI league matchups"
  on public.league_matchups for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_matchups.league_id
        and l.owner_user_id = auth.uid()
        and l.league_type = 'ai'
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = league_matchups.league_id
        and l.owner_user_id = auth.uid()
        and l.league_type = 'ai'
    )
  );

drop policy if exists "Owner manages AI league standings" on public.league_standings;
create policy "Owner manages AI league standings"
  on public.league_standings for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_standings.league_id
        and l.owner_user_id = auth.uid()
        and l.league_type = 'ai'
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = league_standings.league_id
        and l.owner_user_id = auth.uid()
        and l.league_type = 'ai'
    )
  );

-- Human league owner may insert bot draft picks in AI leagues
drop policy if exists "Owner can insert bot draft picks" on public.draft_picks;
create policy "Owner can insert bot draft picks"
  on public.draft_picks for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1
      from public.drafts d
      join public.leagues l on l.id = d.league_id
      join public.profiles p on p.id = draft_picks.user_id
      where d.id = draft_picks.draft_id
        and l.league_type = 'ai'
        and l.owner_user_id = auth.uid()
        and p.is_bot = true
    )
  );

-- drafts: league owners must read/update bot rows (bots have no auth.uid())
drop policy if exists "Users can view own drafts" on public.drafts;
drop policy if exists "Users can view own and league drafts" on public.drafts;
create policy "Users can view own and league drafts"
  on public.drafts for select
  to authenticated
  using (
    auth.uid() = user_id
    or (league_id is not null and public.is_league_member(league_id))
  );

drop policy if exists "Users can insert own drafts" on public.drafts;
drop policy if exists "Owner can insert bot drafts" on public.drafts;
create policy "Users and owners can insert drafts"
  on public.drafts for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or (
      league_id is not null
      and exists (
        select 1
        from public.leagues l
        join public.profiles p on p.id = drafts.user_id
        where l.id = drafts.league_id
          and l.league_type = 'ai'
          and l.owner_user_id = auth.uid()
          and p.is_bot = true
      )
    )
  );

drop policy if exists "Users can update own drafts" on public.drafts;
drop policy if exists "Owner can update bot drafts" on public.drafts;
create policy "Users and owners can update drafts"
  on public.drafts for update
  to authenticated
  using (
    auth.uid() = user_id
    or (
      league_id is not null
      and exists (
        select 1
        from public.leagues l
        join public.profiles p on p.id = drafts.user_id
        where l.id = drafts.league_id
          and l.league_type = 'ai'
          and l.owner_user_id = auth.uid()
          and p.is_bot = true
      )
    )
  )
  with check (
    auth.uid() = user_id
    or (
      league_id is not null
      and exists (
        select 1
        from public.leagues l
        join public.profiles p on p.id = drafts.user_id
        where l.id = drafts.league_id
          and l.league_type = 'ai'
          and l.owner_user_id = auth.uid()
          and p.is_bot = true
      )
    )
  );

-- Owner can add bot members to AI leagues they own
drop policy if exists "Owner can add AI league bot members" on public.league_members;
create policy "Owner can add AI league bot members"
  on public.league_members for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.leagues l
      join public.profiles p on p.id = league_members.user_id
      where l.id = league_members.league_id
        and l.league_type = 'ai'
        and l.owner_user_id = auth.uid()
        and p.is_bot = true
    )
  );

drop policy if exists "Users can create solo leagues" on public.leagues;
drop policy if exists "Users can create AI leagues" on public.leagues;
create policy "Authenticated users can create leagues"
  on public.leagues for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      league_type = 'solo'
      or (league_type = 'ai' and owner_user_id = auth.uid())
    )
  );

-- INSERT ... RETURNING (Supabase .insert().select()) also requires SELECT access.
-- Before league_members exists, only owner_user_id can see a new AI league row.
drop policy if exists "Owners can view their AI leagues" on public.leagues;
create policy "Owners can view their AI leagues"
  on public.leagues for select
  to authenticated
  using (league_type = 'ai' and owner_user_id = auth.uid());

drop policy if exists "Owner can update AI leagues" on public.leagues;
create policy "Owner can update AI leagues"
  on public.leagues for update
  using (owner_user_id = auth.uid() and league_type = 'ai')
  with check (owner_user_id = auth.uid() and league_type = 'ai');

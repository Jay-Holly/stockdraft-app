-- Human vs human leagues: format settings, invites, and RLS for live draft

alter table public.leagues drop constraint if exists leagues_league_type_check;
alter table public.leagues add constraint leagues_league_type_check
  check (league_type in ('solo', 'ai', 'human'));

alter table public.leagues drop constraint if exists leagues_status_check;
alter table public.leagues add constraint leagues_status_check
  check (status in ('waiting', 'drafting', 'active', 'complete'));

alter table public.leagues add column if not exists format_type text not null default 'standard'
  check (format_type in ('standard', 'sports_league'));
alter table public.leagues add column if not exists player_count int not null default 4
  check (player_count in (2, 4, 6, 8, 10, 12));
alter table public.leagues add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'public'));
alter table public.leagues add column if not exists opponent_type text not null default 'all_ai'
  check (opponent_type in ('all_ai', 'all_human', 'mixed'));
alter table public.leagues add column if not exists invite_token uuid unique;
alter table public.leagues add column if not exists invite_email text;

create index if not exists leagues_invite_token_idx on public.leagues (invite_token)
  where invite_token is not null;

-- Helpers
create or replace function public.is_human_league_owner(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and l.league_type = 'human'
      and l.owner_user_id = auth.uid()
  );
$$;

grant execute on function public.is_human_league_owner(uuid) to authenticated;

create or replace function public.is_human_league_member(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and l.league_type = 'human'
  )
  and public.is_league_member(p_league_id);
$$;

grant execute on function public.is_human_league_member(uuid) to authenticated;

create or replace function public.get_league_invite_preview(p_token uuid)
returns table (
  league_id uuid,
  league_name text,
  commissioner_team text,
  member_count bigint,
  player_count int,
  status text,
  opponent_type text,
  format_type text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    l.id,
    l.name,
    coalesce(
      (
        select lm.display_name
        from public.league_members lm
        where lm.league_id = l.id
          and lm.user_id = l.owner_user_id
        limit 1
      ),
      'Commissioner'
    ),
    (
      select count(*)::bigint
      from public.league_members lm
      where lm.league_id = l.id
    ),
    l.player_count,
    l.status,
    l.opponent_type,
    l.format_type
  from public.leagues l
  where l.invite_token = p_token
    and l.league_type = 'human'
  limit 1;
$$;

grant execute on function public.get_league_invite_preview(uuid) to anon, authenticated;

-- League creation: allow human leagues (INSERT WITH CHECK)
drop policy if exists "Authenticated users can create leagues" on public.leagues;
create policy "Authenticated users can create leagues"
  on public.leagues for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      (
        league_type = 'solo'
        and (owner_user_id is null or owner_user_id = auth.uid())
      )
      or (league_type = 'ai' and owner_user_id = auth.uid())
      or (league_type = 'human' and owner_user_id = auth.uid())
    )
  );

-- SELECT: direct row checks for INSERT ... RETURNING (see 021, 029)
drop policy if exists "Members can view their leagues" on public.leagues;
create policy "Members can view their leagues"
  on public.leagues for select
  to authenticated
  using (
    public.is_league_member(id)
    or public.is_unclaimed_solo_league(id)
    or (league_type = 'ai' and owner_user_id = auth.uid())
    or (league_type = 'human' and owner_user_id = auth.uid())
    or (is_solo = true and owner_user_id is null)
  );

drop policy if exists "Owners can view their human leagues" on public.leagues;
create policy "Owners can view their human leagues"
  on public.leagues for select
  to authenticated
  using (league_type = 'human' and owner_user_id = auth.uid());

drop policy if exists "Human league owner can update human leagues" on public.leagues;
create policy "Human league owner can update human leagues"
  on public.leagues for update
  to authenticated
  using (public.is_human_league_owner(id))
  with check (public.is_human_league_owner(id));

-- Members can update league status when joining (waiting → drafting)
drop policy if exists "Human league members can update league status" on public.leagues;
create policy "Human league members can update league status"
  on public.leagues for update
  to authenticated
  using (public.is_human_league_member(id))
  with check (public.is_human_league_member(id));

-- league_members: human owners add themselves; joiners add themselves
drop policy if exists "Human league owner can add members" on public.league_members;
create policy "Human league owner can add members"
  on public.league_members for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or public.is_human_league_owner(league_id)
  );

drop policy if exists "Human league members can update draft slots" on public.league_members;
create policy "Human league members can update draft slots"
  on public.league_members for update
  to authenticated
  using (public.is_human_league_member(league_id))
  with check (public.is_human_league_member(league_id));

drop policy if exists "Members can view league membership" on public.league_members;
create policy "Members can view league membership"
  on public.league_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_league_member(league_id)
    or public.is_ai_league_owner(league_id)
    or public.is_human_league_owner(league_id)
  );

-- Live draft state: human league members manage the session
drop policy if exists "Human league members manage draft state" on public.league_draft_state;
create policy "Human league members manage draft state"
  on public.league_draft_state for all
  to authenticated
  using (public.is_human_league_member(league_id))
  with check (public.is_human_league_member(league_id));

drop policy if exists "Human league members insert draft events" on public.league_draft_events;
create policy "Human league members insert draft events"
  on public.league_draft_events for insert
  to authenticated
  with check (public.is_human_league_member(league_id));

-- Standings / matchups for human leagues
drop policy if exists "Human league members manage standings" on public.league_standings;
create policy "Human league members manage standings"
  on public.league_standings for all
  to authenticated
  using (public.is_human_league_member(league_id))
  with check (public.is_human_league_member(league_id));

drop policy if exists "Human league members manage matchups" on public.league_matchups;
create policy "Human league members manage matchups"
  on public.league_matchups for all
  to authenticated
  using (public.is_human_league_member(league_id))
  with check (public.is_human_league_member(league_id));

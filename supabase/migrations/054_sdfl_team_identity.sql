-- SDFL franchise identity: conference/division slot + flavor fields on league_members.

alter table public.league_members
  add column if not exists conference text,
  add column if not exists division text,
  add column if not exists division_slot int,
  add column if not exists franchise_city text,
  add column if not exists franchise_colors jsonb,
  add column if not exists franchise_logo_url text,
  add column if not exists identity_completed_at timestamptz;

alter table public.league_members drop constraint if exists league_members_conference_check;
alter table public.league_members add constraint league_members_conference_check
  check (conference is null or conference in ('sdal', 'sdnl'));

alter table public.league_members drop constraint if exists league_members_division_check;
alter table public.league_members add constraint league_members_division_check
  check (division is null or division in ('north', 'south', 'east', 'west'));

alter table public.league_members drop constraint if exists league_members_division_slot_check;
alter table public.league_members add constraint league_members_division_slot_check
  check (division_slot is null or division_slot between 1 and 4);

create unique index if not exists league_members_sdfl_division_slot_unique
  on public.league_members (league_id, conference, division, division_slot)
  where conference is not null and division is not null and division_slot is not null;

comment on column public.league_members.franchise_colors is
  'JSON object with primary/secondary hex colors for SDFL franchise branding.';
comment on column public.league_members.franchise_logo_url is
  'Optional AI-generated logo URL (future feature).';

-- Expose sports_league_id on invite previews for SDFL join routing.
create or replace function public.get_league_invite_preview(p_token uuid)
returns table (
  league_id uuid,
  league_name text,
  commissioner_team text,
  member_count bigint,
  player_count int,
  status text,
  opponent_type text,
  format_type text,
  scheduled_draft_at timestamptz,
  sports_league_id text
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
    l.format_type,
    l.scheduled_draft_at,
    l.sports_league_id
  from public.leagues l
  where l.invite_token = p_token
    and l.league_type = 'human'
  limit 1;
$$;

grant execute on function public.get_league_invite_preview(uuid) to anon, authenticated;

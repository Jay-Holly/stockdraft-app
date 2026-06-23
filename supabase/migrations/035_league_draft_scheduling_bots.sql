-- Scheduled drafts, sports league sizing, synthetic bot provisioning, stealth chat

alter table public.leagues add column if not exists scheduled_draft_at timestamptz;
alter table public.leagues add column if not exists sports_league_id text
  check (sports_league_id is null or sports_league_id in ('sdfl', 'sdhl', 'sdba', 'sdlb'));

alter table public.leagues drop constraint if exists leagues_player_count_check;
alter table public.leagues add constraint leagues_player_count_check
  check (player_count in (2, 4, 6, 8, 10, 12, 30, 32));

create or replace function public.provision_league_bot(
  p_league_id uuid,
  p_display_name text,
  p_personality text,
  p_draft_slot int,
  p_bot_config jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bot_id uuid := gen_random_uuid();
  v_colors text[] := array[
    'blue', 'red', 'green', 'purple', 'orange', 'cyan',
    'teal', 'yellow', 'pink', 'indigo', 'slate', 'gold'
  ];
begin
  if not exists (
    select 1 from public.leagues l
    where l.id = p_league_id
      and l.league_type = 'human'
  ) then
    raise exception 'League not found';
  end if;

  insert into public.profiles (id, username, team_name, avatar_color, is_bot)
  values (
    v_bot_id,
    'mgr_' || substr(replace(v_bot_id::text, '-', ''), 1, 10),
    p_display_name,
    v_colors[1 + floor(random() * array_length(v_colors, 1))::int],
    true
  );

  insert into public.league_members (
    league_id,
    user_id,
    display_name,
    bot_personality,
    bot_config,
    draft_slot
  )
  values (
    p_league_id,
    v_bot_id,
    p_display_name,
    p_personality,
    coalesce(p_bot_config, '{}'::jsonb),
    p_draft_slot
  );

  insert into public.drafts (league_id, user_id)
  values (p_league_id, v_bot_id);

  return v_bot_id;
end;
$$;

grant execute on function public.provision_league_bot(uuid, text, text, int, jsonb) to authenticated;

-- Bot draft chat in human leagues (server inserts on behalf of bot profiles)
drop policy if exists "Human league bot draft chat" on public.league_draft_chat_messages;
create policy "Human league bot draft chat"
  on public.league_draft_chat_messages for insert
  to authenticated
  with check (
    message_type = 'bot_reaction'
    and public.is_human_league_member(league_id)
    and exists (
      select 1
      from public.profiles p
      where p.id = user_id
        and p.is_bot = true
    )
  );

-- League owners can insert bot picks for synthetic bots in human leagues
drop policy if exists "Human league owner inserts bot draft picks" on public.draft_picks;
create policy "Human league owner inserts bot draft picks"
  on public.draft_picks for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.drafts d
      join public.leagues l on l.id = d.league_id
      join public.profiles p on p.id = draft_picks.user_id
      where d.id = draft_picks.draft_id
        and d.user_id = draft_picks.user_id
        and l.league_type = 'human'
        and l.owner_user_id = auth.uid()
        and p.is_bot = true
    )
  );

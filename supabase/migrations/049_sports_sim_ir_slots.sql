-- Sports-sim IR slots: pick_type 'ir' on draft_picks + stock-to-player mapping.

alter table public.draft_picks drop constraint if exists draft_picks_pick_type_check;
alter table public.draft_picks add constraint draft_picks_pick_type_check
  check (pick_type in ('stock', 'bench', 'crypto', 'skip', 'ir'));

create table if not exists public.sim_stock_player_map (
  symbol text not null,
  player_id text not null references public.sim_players (player_id) on delete cascade,
  sport text not null check (sport in ('nfl', 'nba', 'nhl', 'mlb')),
  season text not null,
  map_rank int,
  primary key (symbol, sport, season)
);

create index if not exists sim_stock_player_map_sport_season_idx
  on public.sim_stock_player_map (sport, season);

create index if not exists sim_stock_player_map_player_id_idx
  on public.sim_stock_player_map (player_id);

alter table public.sim_stock_player_map enable row level security;

drop policy if exists "sim_stock_player_map_read_authenticated" on public.sim_stock_player_map;
create policy "sim_stock_player_map_read_authenticated"
  on public.sim_stock_player_map
  for select
  to authenticated
  using (true);

alter table public.roster_moves drop constraint if exists roster_moves_move_type_check;
alter table public.roster_moves add constraint roster_moves_move_type_check
  check (
    move_type in (
      'ir_swap',
      'crypto_swap',
      'crypto_rebalance',
      'waiver_add',
      'waiver_drop',
      'ir_move_to',
      'ir_return'
    )
  );

create or replace function public.get_league_drafted_stock_symbols(p_league_id uuid)
returns table (symbol text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and (
        public.is_league_member(p_league_id)
        or (l.league_type = 'ai' and l.owner_user_id = auth.uid())
      )
  ) then
    return;
  end if;

  return query
  select distinct upper(dp.symbol) as symbol
  from public.draft_picks dp
  join public.drafts d on d.id = dp.draft_id
  where d.league_id = p_league_id
    and dp.pick_type in ('stock', 'bench', 'ir')
    and dp.symbol is not null
    and dp.symbol not in ('SKIP', '__OPEN__');
end;
$$;

create or replace function public.count_league_rostered_symbol(
  p_league_id uuid,
  p_symbol text
)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and (
        public.is_league_member(p_league_id)
        or (l.league_type = 'ai' and l.owner_user_id = auth.uid())
      )
  ) then
    return 0;
  end if;

  select count(*)::integer
  into v_count
  from public.draft_picks dp
  join public.drafts d on d.id = dp.draft_id
  where d.league_id = p_league_id
    and dp.pick_type in ('stock', 'bench', 'ir')
    and upper(dp.symbol) = upper(p_symbol)
    and dp.symbol not in ('SKIP', '__OPEN__');

  return coalesce(v_count, 0);
end;
$$;

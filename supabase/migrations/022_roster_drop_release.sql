-- Ensure roster drops release stocks back to the league free-agent pool.
-- Off-board = active stock/bench symbols on any league member's draft.

alter table public.roster_moves drop constraint if exists roster_moves_move_type_check;
alter table public.roster_moves add constraint roster_moves_move_type_check
  check (
    move_type in (
      'ir_swap',
      'crypto_swap',
      'crypto_rebalance',
      'waiver_add',
      'waiver_drop'
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
    and dp.pick_type in ('stock', 'bench')
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
    and dp.pick_type in ('stock', 'bench')
    and upper(dp.symbol) = upper(p_symbol)
    and dp.symbol not in ('SKIP', '__OPEN__');

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.count_league_rostered_symbol(uuid, text) to authenticated;

create or replace function public.patch_my_draft_pick(
  p_pick_id uuid,
  p_updates jsonb
)
returns public.draft_picks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick public.draft_picks;
  v_uid uuid := auth.uid();
  v_symbol text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_pick from public.draft_picks where id = p_pick_id;
  if not found then
    raise exception 'Pick not found';
  end if;
  if v_pick.user_id != v_uid then
    raise exception 'Not authorized to update this pick';
  end if;

  v_symbol := nullif(p_updates->>'symbol', '');
  if v_symbol is not null then
    v_symbol := upper(v_symbol);
  end if;

  update public.draft_picks
  set
    pick_type = coalesce(nullif(p_updates->>'pick_type', ''), pick_type),
    symbol = coalesce(v_symbol, symbol),
    price_at_pick = coalesce((p_updates->>'price_at_pick')::numeric, price_at_pick),
    budget_spent = coalesce((p_updates->>'budget_spent')::numeric, budget_spent),
    shares = coalesce((p_updates->>'shares')::numeric, shares),
    effective_value = coalesce((p_updates->>'effective_value')::numeric, effective_value),
    surcharge_percent = coalesce((p_updates->>'surcharge_percent')::numeric, surcharge_percent),
    acquired_via = coalesce(nullif(p_updates->>'acquired_via', ''), acquired_via),
    updated_at = now()
  where id = p_pick_id
  returning * into v_pick;

  return v_pick;
end;
$$;

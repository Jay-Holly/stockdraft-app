-- Secure roster pick mutations (bypass RLS issues on draft_picks UPDATE/INSERT)

alter table public.roster_moves drop constraint if exists roster_moves_move_type_check;
alter table public.roster_moves add constraint roster_moves_move_type_check
  check (
    move_type in ('ir_swap', 'crypto_swap', 'crypto_rebalance', 'waiver_add')
  );

drop policy if exists "Users can update own draft picks" on public.draft_picks;
create policy "Users can update own draft picks"
  on public.draft_picks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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

  update public.draft_picks
  set
    pick_type = coalesce(nullif(p_updates->>'pick_type', ''), pick_type),
    symbol = coalesce(nullif(p_updates->>'symbol', ''), symbol),
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

create or replace function public.insert_my_draft_pick(
  p_draft_id uuid,
  p_round_number int,
  p_pick_type text,
  p_symbol text,
  p_price_at_pick numeric,
  p_budget_spent numeric,
  p_shares numeric,
  p_surcharge_percent numeric,
  p_effective_value numeric,
  p_pick_order int
)
returns public.draft_picks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick public.draft_picks;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.drafts d
    where d.id = p_draft_id and d.user_id = v_uid
  ) then
    raise exception 'Draft not found or not authorized';
  end if;

  insert into public.draft_picks (
    draft_id,
    user_id,
    round_number,
    pick_type,
    symbol,
    price_at_pick,
    budget_spent,
    shares,
    surcharge_percent,
    effective_value,
    pick_order,
    acquired_via
  ) values (
    p_draft_id,
    v_uid,
    p_round_number,
    p_pick_type,
    upper(p_symbol),
    p_price_at_pick,
    p_budget_spent,
    p_shares,
    p_surcharge_percent,
    p_effective_value,
    p_pick_order,
    'draft'
  )
  returning * into v_pick;

  return v_pick;
end;
$$;

grant execute on function public.patch_my_draft_pick(uuid, jsonb) to authenticated;
grant execute on function public.insert_my_draft_pick(uuid, int, text, text, numeric, numeric, numeric, numeric, numeric, int) to authenticated;

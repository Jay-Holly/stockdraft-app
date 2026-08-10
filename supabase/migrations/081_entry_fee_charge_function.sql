-- Atomically checks balance and charges an entry fee, avoiding a race
-- between two concurrent entries both reading a stale balance.
create or replace function public.charge_entry_fee(
  p_user_id uuid,
  p_amount numeric,
  p_description text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_id uuid;
begin
  if auth.role() <> 'service_role' and auth.uid() <> p_user_id then
    raise exception 'not_authorized';
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.wallet_transactions
  where user_id = p_user_id
    and status in ('completed', 'pending');

  if v_balance < p_amount then
    raise exception 'insufficient_balance';
  end if;

  insert into public.wallet_transactions (user_id, type, amount, status, description)
  values (p_user_id, 'entry_fee', -p_amount, 'completed', p_description)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.charge_entry_fee(uuid, numeric, text) from public;
grant execute on function public.charge_entry_fee(uuid, numeric, text) to authenticated, service_role;

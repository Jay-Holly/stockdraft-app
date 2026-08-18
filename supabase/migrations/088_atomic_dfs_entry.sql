-- Makes entering a DFS contest one transaction instead of three separate
-- writes with app-level compensation.
--
-- The enter routes used to: insert an entry, charge the fee, then insert 12
-- picks — three round trips, with manual delete-and-refund code in case a
-- later step failed. That compensation only runs if the same request that
-- started the sequence is still alive to run it. If the request dies in
-- between — a timeout, a dropped connection, the function getting killed —
-- nothing rolls anything back, and the entry survives with no fee charged
-- and no picks. Confirmed twice in production: an entry with 0 picks and no
-- entry_fee transaction, still scored, still ranked, still paid out, because
-- nothing downstream knew it wasn't a real entry.
--
-- A single plpgsql function closes that gap by construction. Everything
-- inside runs in one transaction; any exception — insufficient balance, a
-- locked or full contest, a bad picks array — rolls back the entire thing.
-- There is no partial state left for the caller to fail to clean up, because
-- there is no cleanup step: either the whole entry exists, fee charged and
-- all 12 picks attached, or none of it does.
--
-- Pick *content* validation (real symbol, right sector, no duplicates) stays
-- in TypeScript (validateDfsPicks) and still runs before this is ever called
-- — that is business logic worth keeping in one place and easy to test. This
-- function only guarantees that once picks have been accepted, the write
-- that persists them cannot happen halfway.

create or replace function public.enter_sddfs_contest(
  p_contest_id uuid,
  p_user_id uuid,
  p_picks jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contest record;
  v_entry_id uuid;
  v_pick jsonb;
begin
  if auth.role() <> 'service_role' and auth.uid() <> p_user_id then
    raise exception 'not_authorized';
  end if;

  if jsonb_array_length(p_picks) <> 12 then
    raise exception 'invalid_picks';
  end if;

  select id, status, buy_in, max_entrants
    into v_contest
    from public.sddfs_contests
    where id = p_contest_id
    for update;

  if not found then
    raise exception 'contest_not_found';
  end if;
  if v_contest.status <> 'open' then
    raise exception 'contest_locked';
  end if;

  if v_contest.max_entrants is not null and v_contest.max_entrants > 0 then
    if (select count(*) from public.sddfs_entries where contest_id = p_contest_id)
       >= v_contest.max_entrants then
      raise exception 'contest_full';
    end if;
  end if;

  insert into public.sddfs_entries (contest_id, user_id)
  values (p_contest_id, p_user_id)
  returning id into v_entry_id;

  if v_contest.buy_in > 0 then
    perform public.charge_entry_fee(p_user_id, v_contest.buy_in, 'SDDFS entry fee');
  end if;

  for v_pick in select * from jsonb_array_elements(p_picks)
  loop
    insert into public.sddfs_entry_picks (entry_id, sector, symbol)
    values (v_entry_id, v_pick->>'sector', v_pick->>'symbol');
  end loop;

  return v_entry_id;
end;
$$;

revoke all on function public.enter_sddfs_contest(uuid, uuid, jsonb) from public;
grant execute on function public.enter_sddfs_contest(uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.enter_sdwfs_contest(
  p_contest_id uuid,
  p_user_id uuid,
  p_picks jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contest record;
  v_entry_id uuid;
  v_pick jsonb;
begin
  if auth.role() <> 'service_role' and auth.uid() <> p_user_id then
    raise exception 'not_authorized';
  end if;

  if jsonb_array_length(p_picks) <> 12 then
    raise exception 'invalid_picks';
  end if;

  select id, status, buy_in, max_entrants
    into v_contest
    from public.sdwfs_contests
    where id = p_contest_id
    for update;

  if not found then
    raise exception 'contest_not_found';
  end if;
  if v_contest.status <> 'open' then
    raise exception 'contest_locked';
  end if;

  if v_contest.max_entrants is not null and v_contest.max_entrants > 0 then
    if (select count(*) from public.sdwfs_entries where contest_id = p_contest_id)
       >= v_contest.max_entrants then
      raise exception 'contest_full';
    end if;
  end if;

  insert into public.sdwfs_entries (contest_id, user_id)
  values (p_contest_id, p_user_id)
  returning id into v_entry_id;

  if v_contest.buy_in > 0 then
    perform public.charge_entry_fee(p_user_id, v_contest.buy_in, 'SDWFS entry fee');
  end if;

  for v_pick in select * from jsonb_array_elements(p_picks)
  loop
    insert into public.sdwfs_entry_picks (entry_id, sector, symbol)
    values (v_entry_id, v_pick->>'sector', v_pick->>'symbol');
  end loop;

  return v_entry_id;
end;
$$;

revoke all on function public.enter_sdwfs_contest(uuid, uuid, jsonb) from public;
grant execute on function public.enter_sdwfs_contest(uuid, uuid, jsonb) to authenticated, service_role;

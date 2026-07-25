-- makeDraftPickForLeague previously did two separate writes: insert into
-- draft_picks, then update drafts.current_round. These weren't atomic — if
-- the round-bump update failed (or the request errored/retried) after the
-- insert had already committed, the caller saw an error and retried, which
-- re-read the still-stale current_round and inserted a SECOND pick labeled
-- with the same round number, permanently corrupting that team's round
-- bookkeeping (confirmed on multiple teams during a retry storm caused by
-- an earlier, now-fixed RLS bug).
--
-- This function performs both writes inside a single Postgres function call,
-- which Postgres executes as one implicit transaction: if anything after the
-- insert fails, the insert itself rolls back too, so a caller-visible error
-- always means nothing was written. Runs as SECURITY INVOKER (default) so it
-- is still subject to the caller's own RLS on both tables, same as before.

create or replace function public.insert_draft_pick_atomic(
  p_draft_id uuid,
  p_user_id uuid,
  p_round_number int,
  p_pick_type text,
  p_symbol text,
  p_price_at_pick numeric,
  p_budget_spent numeric,
  p_shares numeric,
  p_surcharge_percent numeric,
  p_effective_value numeric,
  p_pick_order int,
  p_is_auto_pick boolean,
  p_auto_pick_reason text,
  p_next_round int,
  p_pushback_skips_remaining int,
  p_draft_status text,
  p_completed_at timestamptz
)
returns public.draft_picks
language plpgsql
as $$
declare
  v_pick public.draft_picks;
begin
  insert into public.draft_picks (
    draft_id, user_id, round_number, pick_type, symbol, price_at_pick,
    budget_spent, shares, surcharge_percent, effective_value, pick_order,
    is_auto_pick, auto_pick_reason
  ) values (
    p_draft_id, p_user_id, p_round_number, p_pick_type, p_symbol, p_price_at_pick,
    p_budget_spent, p_shares, p_surcharge_percent, p_effective_value, p_pick_order,
    p_is_auto_pick, p_auto_pick_reason
  )
  returning * into v_pick;

  update public.drafts
  set
    current_round = p_next_round,
    pushback_skips_remaining = p_pushback_skips_remaining,
    status = p_draft_status,
    completed_at = p_completed_at
  where id = p_draft_id;

  return v_pick;
end;
$$;

grant execute on function public.insert_draft_pick_atomic(
  uuid, uuid, int, text, text, numeric, numeric, numeric, numeric, numeric,
  int, boolean, text, int, int, text, timestamptz
) to authenticated;

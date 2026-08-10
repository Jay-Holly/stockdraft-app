-- insert_draft_pick_atomic (077) requires either auth.uid() = p_user_id or
-- is_league_member(v_league_id) — but is_league_member() itself checks
-- auth.uid() internally. A cron-driven bot auto-pick (advance-live-drafts,
-- service-role client) has auth.uid() = null, so BOTH checks fail: no
-- browser tab open means no human session to satisfy is_league_member(),
-- so every bot pick attempted by the cron alone is rejected with "Not
-- authorized to insert a pick for this draft" — silently, forever, once
-- per lease cycle, with the pick_deadline just getting re-claimed and
-- re-expiring in a loop. This is what stalled SDFL-00106's autodraft.
--
-- Per 077's own stated design, the app-level API route already fully
-- authenticates and validates turn eligibility before this function is
-- ever called — this function's own check is redundant defense-in-depth,
-- not the primary gate. Service-role callers (auth.uid() is null) reach
-- this function only through trusted server-side code paths (the cron),
-- so skip the ownership/membership check entirely when there's no
-- authenticated user at all, rather than trying to make a real user's
-- membership check pass for a caller that was never a real user.

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
security definer
set search_path = public
as $$
declare
  v_pick public.draft_picks;
  v_league_id uuid;
begin
  select league_id into v_league_id from public.drafts where id = p_draft_id;

  if v_league_id is null then
    raise exception 'Draft % not found', p_draft_id;
  end if;

  if auth.uid() is not null
     and auth.uid() is distinct from p_user_id
     and not public.is_league_member(v_league_id) then
    raise exception 'Not authorized to insert a pick for this draft';
  end if;

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

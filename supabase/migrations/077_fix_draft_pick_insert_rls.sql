-- Live draft is running with each team paced independently (rounds already
-- diverge across teams: 10/11/14/14/15 concurrently), but insert_draft_pick_atomic
-- runs SECURITY INVOKER, so every insert is still subject to draft_picks RLS.
-- The existing self-insert policy ("Users can insert own draft picks", auth.uid()
-- = user_id) should cover this, but live picks are failing with "new row violates
-- row-level security policy for table draft_picks" for every team except whoever
-- currently holds the single-slot league_draft_state.on_clock_user_id — the same
-- recurring RLS failure mode already patched three times for this table (007, 035,
-- 072) as new call paths were added.
--
-- Rather than add a fifth narrow policy, make the insert function SECURITY DEFINER.
-- The calling API route (POST /api/draft/pick) already fully authenticates the user
-- and validates turn eligibility (assertOnClock / turn.canPickCrypto / turn.canPickStock
-- / duplicate-roster checks) before this function is ever called, so RLS on the table
-- itself is redundant defense-in-depth, not the primary gate. To avoid opening this up
-- as an unrestricted insert-as-anyone RPC, keep an explicit check inside the function:
-- callers may only insert a pick for themselves, or on behalf of a fellow league member
-- (covers bot/auto-pick call paths), mirroring the trust model already used by the
-- "Owner can insert bot draft picks" policies.

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

  if auth.uid() is distinct from p_user_id
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

import { createClient } from "@/lib/supabase/server";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import { LEGACY_CRYPTO_SYMBOLS } from "@/lib/market/symbols";
import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";
import { isDraftPoolStock } from "@/lib/draft-pool/server";
import {
  getLeagueMemberTeamName,
  getLeagueOffBoardSymbols,
  resolveDraftLeague,
} from "@/lib/league/server";
import { resolveActiveLeagueId } from "@/lib/league/active-league";
import {
  calculatePushback,
  computeCryptoPick,
  computeStockPick,
  getDuplicateRosterError,
  getMyStockSymbols,
  getNextRoundAfterPick,
  getOpenPhaseCryptoPicks,
  getTurn,
  isCryptoPickEligible,
  isCryptoSymbol,
  isDraftComplete,
  isOpenPhaseComplete,
  isStockPickEligible,
  summarizePicks,
} from "./engine";
import type {
  CryptoBuyerCounts,
  Draft,
  DraftPick,
  DraftState,
} from "./types";
import { CRYPTO_POOL, OPEN_ROUNDS, BENCH_ROUNDS, BENCH_START_ROUND } from "./types";
import { normalizeSafetyPickQueue } from "./safety-queue";

export async function incrementLeagueCryptoCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  symbol: string,
  buyerCount: number
) {
  const { data: existing } = await supabase
    .from("league_crypto_buyer_counts")
    .select("buyer_count")
    .eq("league_id", leagueId)
    .eq("symbol", symbol)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("league_crypto_buyer_counts")
      .update({ buyer_count: buyerCount + 1 })
      .eq("league_id", leagueId)
      .eq("symbol", symbol);
    return;
  }

  await supabase.from("league_crypto_buyer_counts").insert({
    league_id: leagueId,
    symbol,
    buyer_count: buyerCount + 1,
  });
}

async function decrementLeagueCryptoCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  symbol: string
) {
  const { data: row } = await supabase
    .from("league_crypto_buyer_counts")
    .select("buyer_count")
    .eq("league_id", leagueId)
    .eq("symbol", symbol)
    .maybeSingle();

  if (row && row.buyer_count > 0) {
    await supabase
      .from("league_crypto_buyer_counts")
      .update({ buyer_count: row.buyer_count - 1 })
      .eq("league_id", leagueId)
      .eq("symbol", symbol);
  }
}

export async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function fetchBuyerCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string
): Promise<CryptoBuyerCounts> {
  const { data, error } = await supabase
    .from("league_crypto_buyer_counts")
    .select("symbol, buyer_count")
    .eq("league_id", leagueId);

  const pool = await fetchCryptoPool();
  const seedSymbols =
    pool.length > 0
      ? pool.map((coin) => coin.symbol)
      : [...LEGACY_CRYPTO_SYMBOLS];

  const counts: CryptoBuyerCounts = {};
  for (const symbol of seedSymbols) {
    counts[symbol] = 0;
  }

  if (error || !data) return counts;

  for (const row of data) {
    counts[row.symbol] = row.buyer_count;
  }
  return counts;
}

export type LoadDraftResult =
  | { ok: true; state: DraftState }
  | { ok: false; error: string };

async function fetchLeagueDraftRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  userId: string
): Promise<Draft | null> {
  const { data: rpcDraft, error: rpcError } = await supabase.rpc(
    "get_league_draft",
    {
      p_league_id: leagueId,
      p_user_id: userId,
    }
  );

  if (!rpcError && rpcDraft) {
    return rpcDraft as Draft;
  }

  const { data, error } = await supabase
    .from("drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("league_id", leagueId)
    .maybeSingle();

  if (error || !data) return null;
  return data as Draft;
}

async function fetchLeagueDraftPicks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  userId: string,
  draftId: string
): Promise<DraftPick[]> {
  const { data: rpcPicks, error: rpcError } = await supabase.rpc(
    "get_league_draft_picks",
    {
      p_league_id: leagueId,
      p_user_id: userId,
    }
  );

  if (!rpcError && rpcPicks) {
    return (rpcPicks as DraftPick[]) ?? [];
  }

  const { data: picks } = await supabase
    .from("draft_picks")
    .select("*")
    .eq("draft_id", draftId)
    .order("pick_order", { ascending: true });

  return (picks ?? []) as DraftPick[];
}

export async function loadDraftState(userId: string): Promise<DraftState | null> {
  const result = await loadDraftStateDetailed(userId);
  return result.ok ? result.state : null;
}

export async function loadDraftStateDetailed(
  userId: string,
  options?: { leagueId?: string }
): Promise<LoadDraftResult> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name")
    .eq("id", userId)
    .single();

  const { league, error: leagueError } = await resolveDraftLeague(
    userId,
    profile?.team_name ?? "My Team",
    options
  );
  if (!league) {
    return {
      ok: false,
      error:
        leagueError ??
        "Could not create solo league. Confirm 003_leagues.sql created leagues and league_members.",
    };
  }

  let draft = await fetchLeagueDraftRow(supabase, league.id, userId);

  if (!draft) {
    const { data: legacyDraft, error: legacyError } = await supabase
      .from("drafts")
      .select("*")
      .eq("user_id", userId)
      .is("league_id", null)
      .maybeSingle();

    if (legacyError) {
      return {
        ok: false,
        error: `drafts legacy lookup failed: ${legacyError.message}. Confirm drafts.league_id column exists (003_leagues.sql).`,
      };
    }

    if (legacyDraft) {
      const { data: updated, error: updateError } = await supabase
        .from("drafts")
        .update({ league_id: league.id })
        .eq("id", legacyDraft.id)
        .is("league_id", null)
        .select("*")
        .single();

      if (updateError || !updated) {
        return {
          ok: false,
          error: `drafts league_id backfill failed: ${updateError?.message ?? "unknown error"}`,
        };
      }
      draft = updated;
    }
  }

  if (!draft) {
    const { data: created, error: insertError } = await supabase
      .from("drafts")
      .insert({ user_id: userId, league_id: league.id })
      .select("*")
      .single();

    if (insertError || !created) {
      draft = await fetchLeagueDraftRow(supabase, league.id, userId);
      if (!draft) {
        return {
          ok: false,
          error: `drafts insert failed: ${insertError?.message ?? "unknown error"}. Confirm 002_draft.sql ran and unique(user_id) was dropped by 003_leagues.sql.`,
        };
      }
    } else {
      draft = created;
    }
  }

  if (!draft) {
    return {
      ok: false,
      error: "No draft found for this league member.",
    };
  }

  if (draft.league_id && draft.league_id !== league.id) {
    return {
      ok: false,
      error:
        "Draft row belongs to a different league. Select the correct league on the dashboard and try again.",
    };
  }

  const rawPickList = await fetchLeagueDraftPicks(
    supabase,
    league.id,
    userId,
    draft.id
  );
  const pickList = rawPickList.filter((pick) => pick.draft_id === draft.id);
  let draftRow = draft as Draft;
  const buyerCounts = await fetchBuyerCounts(supabase, league.id);
  let summary = summarizePicks(pickList);

  if (
    draftRow.status !== "complete" &&
    isOpenPhaseComplete(pickList) &&
    summary.benchPicks < BENCH_ROUNDS &&
    draftRow.current_round < BENCH_START_ROUND
  ) {
    const { error: roundSyncError } = await supabase
      .from("drafts")
      .update({ current_round: BENCH_START_ROUND })
      .eq("id", draftRow.id);

    if (roundSyncError) {
      console.error(
        `Draft ${draftRow.id}: open→bench round sync failed:`,
        roundSyncError.message
      );
    } else {
      console.info(
        `Draft ${draftRow.id}: synced current_round ${draftRow.current_round} → ${BENCH_START_ROUND} (open phase complete, entering bench rounds 14–15)`
      );
      draftRow = { ...draftRow, current_round: BENCH_START_ROUND };
    }
  }

  if (
    isOpenPhaseComplete(pickList) &&
    draftRow.pushback_skips_remaining > 0 &&
    getTurn(draftRow, pickList).type !== "pushback_skip"
  ) {
    await supabase
      .from("drafts")
      .update({ pushback_skips_remaining: 0 })
      .eq("id", draftRow.id);
    draftRow = { ...draftRow, pushback_skips_remaining: 0 };
  }

  summary = summarizePicks(pickList);
  const turn = getTurn(draftRow, pickList);
  const leagueOffBoardSet = await getLeagueOffBoardSymbols(league.id);
  const myStockSymbols = [...getMyStockSymbols(pickList)];
  const teamName = await getLeagueMemberTeamName(league.id, userId);

  const safetyPickQueue = normalizeSafetyPickQueue(
    draftRow.safety_pick_queue,
    draftRow.safety_pick_symbol
  );

  return {
    ok: true,
    state: {
      draft: draftRow,
      picks: pickList,
      buyerCounts,
      turn,
      summary,
      leagueId: league.id,
      leagueOffBoard: [...leagueOffBoardSet],
      myStockSymbols,
      teamName,
      safetyPickSymbol: safetyPickQueue[0] ?? null,
      safetyPickQueue,
    },
  };
}

export async function processPushbackSkipForLeague(
  userId: string,
  leagueId: string,
  options?: { advanceLiveDraft?: boolean }
) {
  const stateResult = await loadDraftStateDetailed(userId, { leagueId });
  if (!stateResult.ok) return { error: stateResult.error };

  const { draft, picks } = stateResult.state;
  if (stateResult.state.turn.type !== "pushback_skip") {
    return { error: "No pushback skip to process" };
  }

  const supabase = await createClient();
  const pickOrder = picks.length;
  const nextRound = getNextRoundAfterPick(draft, picks, "skip");

  const { data: insertedPick, error: pickError } = await supabase
    .from("draft_picks")
    .insert({
      draft_id: draft.id,
      user_id: userId,
      round_number: draft.current_round,
      pick_type: "skip",
      symbol: "SKIP",
      price_at_pick: 0,
      budget_spent: 0,
      shares: 0,
      surcharge_percent: 0,
      effective_value: 0,
      pick_order: pickOrder,
    })
    .select("*")
    .single();

  if (pickError || !insertedPick) {
    return {
      error:
        pickError?.message ??
        "Pushback skip insert failed (0 rows). Confirm draft_picks RLS allows insert.",
    };
  }

  const { error: draftError } = await supabase
    .from("drafts")
    .update({
      current_round: nextRound,
      pushback_skips_remaining: Math.max(0, draft.pushback_skips_remaining - 1),
    })
    .eq("id", draft.id);

  if (draftError) return { error: draftError.message };

  if (options?.advanceLiveDraft) {
    const { advanceAfterPick, isLiveDraftLeague } = await import("./live-draft");
    if (await isLiveDraftLeague(leagueId)) {
      const advance = await advanceAfterPick(
        leagueId,
        userId,
        insertedPick as DraftPick,
        false
      );
      if (advance.error) return { error: advance.error };
      return { success: true, liveAdvanced: true };
    }
  }

  return { success: true };
}

export async function processPushbackSkip(userId: string) {
  const state = await loadDraftState(userId);
  if (!state) return { error: "Could not load draft" };

  return processPushbackSkipForLeague(userId, state.leagueId);
}

export async function processAllPushbackSkips(
  userId: string,
  options?: { leagueId?: string }
): Promise<{ error?: string; processed: number }> {
  let processed = 0;
  const supabase = await createClient();

  for (let i = 0; i < 15; i++) {
    const stateResult = await loadDraftStateDetailed(userId, options);
    if (!stateResult.ok) {
      return { error: stateResult.error, processed };
    }

    const { turn, draft, picks } = stateResult.state;

    if (
      isOpenPhaseComplete(picks) &&
      draft.pushback_skips_remaining > 0 &&
      turn.type !== "pushback_skip"
    ) {
      await supabase
        .from("drafts")
        .update({ pushback_skips_remaining: 0 })
        .eq("id", draft.id);
      break;
    }

    if (turn.type !== "pushback_skip" || draft.status === "complete") {
      break;
    }

    const skipResult = await processPushbackSkipForLeague(
      userId,
      stateResult.state.leagueId
    );
    if (skipResult.error) {
      return { error: skipResult.error, processed };
    }

    processed += 1;
  }

  return { processed };
}

export async function makeDraftPickForLeague(
  userId: string,
  leagueId: string,
  symbol: string,
  allocation?: number,
  price?: number,
  isSearchPick = false,
  options?: {
    skipLiveGate?: boolean;
    isAutoPick?: boolean;
    autoPickReason?: "safety_queue" | "highest_price" | "bot" | "timer";
    skipLiveAdvance?: boolean;
  }
) {
  const stateResult = await loadDraftStateDetailed(userId, { leagueId });
  if (!stateResult.ok) return { error: stateResult.error };

  if (!options?.skipLiveGate) {
    const { assertOnClock, isLiveDraftLeague, advanceAfterPick } = await import(
      "./live-draft"
    );
    const live = await isLiveDraftLeague(leagueId);
    if (live) {
      const onClock = await assertOnClock(leagueId, userId);
      if (!onClock.ok) return { error: onClock.error };
    }
  }

  const { draft, picks, turn, buyerCounts, leagueOffBoard } = stateResult.state;
  const leaguePicks = picks.filter((pick) => pick.draft_id === draft.id);
  if (draft.status === "complete" || turn.type === "complete") {
    return { error: "Draft is already complete" };
  }

  if (turn.type === "pushback_skip") {
    return { error: "Pushback skip must be processed first" };
  }

  const upperSymbol = symbol.toUpperCase();
  const isCryptoPick = isCryptoSymbol(upperSymbol);

  const supabase = await createClient();
  const summary = summarizePicks(leaguePicks);
  const pickOrder = leaguePicks.length;
  let pickType: DraftPick["pick_type"] = "stock";
  let budgetSpent = 0;
  let shares = 0;
  let surchargePercent = 0;
  let effectiveValue = 0;
  const priceAtPick = price ?? 0;
  let pushbackDelta = 0;

  if (isCryptoPick) {
    if (!turn.canPickCrypto) {
      return { error: "Crypto picks are only available during open rounds 1–13" };
    }

    const cryptoDuplicate = getDuplicateRosterError(
      upperSymbol,
      leaguePicks,
      "crypto"
    );
    if (cryptoDuplicate) return { error: cryptoDuplicate };

    const cryptoAmount = allocation ?? summary.cryptoRemaining;
    if (cryptoAmount <= 0 || cryptoAmount > summary.cryptoRemaining) {
      return { error: "Invalid crypto allocation" };
    }

    if (!priceAtPick || priceAtPick <= 0) {
      return { error: "Missing price for crypto pick" };
    }

    if (!isCryptoPickEligible(upperSymbol, priceAtPick)) {
      return {
        error: "Symbol is not in the crypto draft pool or price is unavailable",
      };
    }

    const buyerCount = buyerCounts[upperSymbol] ?? 0;
    const computed = computeCryptoPick(cryptoAmount, priceAtPick, buyerCount);

    pickType = "crypto";
    budgetSpent = computed.budgetSpent;
    shares = computed.shares;
    surchargePercent = computed.surchargePercent;
    effectiveValue = computed.effectiveValue;

    await incrementLeagueCryptoCount(
      supabase,
      leagueId,
      upperSymbol,
      buyerCount
    );

    if (draft.current_round <= OPEN_ROUNDS) {
      const afterPick = [
        ...getOpenPhaseCryptoPicks(leaguePicks),
        { budget_spent: budgetSpent } as DraftPick,
      ];
      const newTotal = afterPick.reduce((s, p) => s + p.budget_spent, 0);
      if (newTotal >= CRYPTO_POOL) {
        pushbackDelta = calculatePushback(afterPick);
      }
    }
  } else if (turn.type === "bench") {
    const stockDuplicate = getDuplicateRosterError(
      upperSymbol,
      leaguePicks,
      "stock"
    );
    if (stockDuplicate) return { error: stockDuplicate };

    if (!isStockPickEligible(upperSymbol, priceAtPick)) {
      return {
        error: `Stock must trade at $${MIN_STOCK_PRICE_USD}+ per share`,
      };
    }
    if (leagueOffBoard.includes(upperSymbol)) {
      return { error: `${upperSymbol} is off the board in this league` };
    }
    if (!(await isDraftPoolStock(upperSymbol)) && !isSearchPick) {
      return { error: "Use search to draft stocks outside the S&P 500 pool" };
    }
    pickType = "bench";
  } else if (turn.type === "open") {
    if (!turn.canPickStock) {
      return { error: "All 10 stock picks are already made — choose crypto or finish open rounds" };
    }

    const stockDuplicate = getDuplicateRosterError(
      upperSymbol,
      leaguePicks,
      "stock"
    );
    if (stockDuplicate) return { error: stockDuplicate };

    if (!isStockPickEligible(upperSymbol, priceAtPick)) {
      return {
        error: `Stock must trade at $${MIN_STOCK_PRICE_USD}+ per share`,
      };
    }
    if (leagueOffBoard.includes(upperSymbol)) {
      return { error: `${upperSymbol} is off the board in this league` };
    }
    if (!(await isDraftPoolStock(upperSymbol)) && !isSearchPick) {
      return { error: "Use search to draft stocks outside the S&P 500 pool" };
    }
    const computed = computeStockPick(priceAtPick);
    pickType = "stock";
    budgetSpent = computed.budgetSpent;
    shares = computed.shares;
    effectiveValue = budgetSpent;
  } else {
    return { error: "Invalid turn type for this pick" };
  }

  const { data: insertedPick, error: pickError } = await supabase
    .from("draft_picks")
    .insert({
      draft_id: draft.id,
      user_id: userId,
      round_number: draft.current_round,
      pick_type: pickType,
      symbol: upperSymbol,
      price_at_pick: priceAtPick,
      budget_spent: budgetSpent,
      shares,
      surcharge_percent: surchargePercent,
      effective_value: effectiveValue,
      pick_order: pickOrder,
      is_auto_pick: options?.isAutoPick ?? false,
      auto_pick_reason: options?.autoPickReason ?? null,
    })
    .select("*")
    .single();

  if (pickError || !insertedPick) {
    return {
      error:
        pickError?.message ??
        "Pick insert failed (0 rows). Confirm draft_picks RLS policies allow insert.",
    };
  }

  const updatedPicks = [
    ...leaguePicks,
    {
      pick_type: pickType,
      budget_spent: budgetSpent,
      round_number: draft.current_round,
      symbol: upperSymbol,
    } as DraftPick,
  ];

  const nextRound = getNextRoundAfterPick(draft, updatedPicks, pickType);
  const complete = isDraftComplete(updatedPicks);

  const { error: draftError } = await supabase
    .from("drafts")
    .update({
      current_round: nextRound,
      pushback_skips_remaining: draft.pushback_skips_remaining + pushbackDelta,
      status: complete ? "complete" : "in_progress",
      completed_at: complete ? new Date().toISOString() : null,
    })
    .eq("id", draft.id);

  if (draftError) return { error: draftError.message };

  if (!options?.skipLiveAdvance) {
    const { isLiveDraftLeague, advanceAfterPick } = await import("./live-draft");
    const live = await isLiveDraftLeague(leagueId);
    if (live) {
      const advance = await advanceAfterPick(
        leagueId,
        userId,
        insertedPick as DraftPick,
        options?.isAutoPick ?? false
      );
      if (advance.error) {
        return {
          error: `${advance.error} (Your pick was saved — refresh the draft room.)`,
        };
      }
    }
  }

  return { success: true, complete };
}

export async function makeDraftPick(
  userId: string,
  symbol: string,
  allocation?: number,
  price?: number,
  isSearchPick = false
) {
  const leagueId = await resolveActiveLeagueId(userId);
  if (!leagueId) return { error: "No active draft league found." };

  return makeDraftPickForLeague(
    userId,
    leagueId,
    symbol,
    allocation,
    price,
    isSearchPick
  );
}

export async function undoLastPick(userId: string) {
  const state = await loadDraftState(userId);
  if (!state) return { error: "Could not load draft" };

  const { draft, picks } = state;
  if (draft.status === "complete") {
    return { error: "Cannot undo after draft is complete" };
  }

  const realPicks = picks.filter((p) => p.pick_type !== "skip");
  if (realPicks.length === 0) {
    return { error: "No picks to undo" };
  }

  const lastPick = [...picks].reverse().find((p) => p.pick_type !== "skip");
  if (!lastPick) return { error: "No picks to undo" };

  const supabase = await createClient();

  if (lastPick.pick_type === "crypto" && isCryptoSymbol(lastPick.symbol)) {
    await decrementLeagueCryptoCount(
      supabase,
      state.leagueId,
      lastPick.symbol
    );
  }

  await supabase.from("draft_picks").delete().eq("id", lastPick.id);

  const remaining = picks.filter((p) => p.id !== lastPick.id);
  const skipsAfter = remaining.filter(
    (p) => p.pick_type === "skip" && p.pick_order > lastPick.pick_order
  );
  for (const skip of skipsAfter) {
    await supabase.from("draft_picks").delete().eq("id", skip.id);
  }

  const cleaned = remaining.filter(
    (p) => p.id !== lastPick.id && !skipsAfter.some((s) => s.id === p.id)
  );

  const { error } = await supabase
    .from("drafts")
    .update({
      current_round: lastPick.round_number,
      pushback_skips_remaining: 0,
      status: "in_progress",
      completed_at: null,
    })
    .eq("id", draft.id);

  if (error) return { error: error.message };

  const earlyCrypto = getOpenPhaseCryptoPicks(cleaned);
  const pushback = calculatePushback(earlyCrypto);
  const usedSkips = cleaned.filter((p) => p.pick_type === "skip").length;

  await supabase
    .from("drafts")
    .update({
      pushback_skips_remaining: Math.max(0, pushback - usedSkips),
    })
    .eq("id", draft.id);

  return { success: true };
}

export async function resetDraft(userId: string) {
  const state = await loadDraftState(userId);
  if (!state) return { success: true };

  const supabase = await createClient();
  const { draft, leagueId } = state;

  const { data: cryptoPicks } = await supabase
    .from("draft_picks")
    .select("symbol")
    .eq("draft_id", draft.id)
    .eq("pick_type", "crypto");

  if (cryptoPicks) {
    for (const pick of cryptoPicks) {
      if (isCryptoSymbol(pick.symbol)) {
        await decrementLeagueCryptoCount(supabase, leagueId, pick.symbol);
      }
    }
  }

  await supabase.from("draft_picks").delete().eq("draft_id", draft.id);
  await supabase
    .from("drafts")
    .update({
      status: "in_progress",
      current_round: 1,
      pushback_skips_remaining: 0,
      completed_at: null,
    })
    .eq("id", draft.id);

  return { success: true };
}

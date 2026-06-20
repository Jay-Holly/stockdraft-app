import { createClient } from "@/lib/supabase/server";
import { CRYPTO_SYMBOLS } from "@/lib/market/symbols";
import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";
import { isDraftPoolStock } from "@/lib/draft-pool/server";
import {
  getLeagueOffBoardSymbols,
  getOrCreateSoloLeague,
} from "@/lib/league/server";
import {
  calculatePushback,
  computeCryptoPick,
  computeStockPick,
  getMyDraftedSymbols,
  getNextRoundAfterPick,
  getTurn,
  isCryptoSymbol,
  isDraftComplete,
  isStockPickEligible,
  summarizePicks,
} from "./engine";
import type {
  CryptoBuyerCounts,
  Draft,
  DraftPick,
  DraftState,
} from "./types";
import { CRYPTO_POOL, STOCK_ROUNDS } from "./types";

async function incrementLeagueCryptoCount(
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

  const counts: CryptoBuyerCounts = {};
  for (const symbol of CRYPTO_SYMBOLS) {
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

export async function loadDraftState(userId: string): Promise<DraftState | null> {
  const result = await loadDraftStateDetailed(userId);
  return result.ok ? result.state : null;
}

export async function loadDraftStateDetailed(
  userId: string
): Promise<LoadDraftResult> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name")
    .eq("id", userId)
    .single();

  const { league, error: leagueError } = await getOrCreateSoloLeague(
    userId,
    profile?.team_name ?? "My Team"
  );
  if (!league) {
    return {
      ok: false,
      error:
        leagueError ??
        "Could not create solo league. Confirm 003_leagues.sql created leagues and league_members.",
    };
  }

  let { data: draft, error: draftLookupError } = await supabase
    .from("drafts")
    .select("*")
    .eq("user_id", userId)
    .eq("league_id", league.id)
    .maybeSingle();

  if (draftLookupError) {
    return {
      ok: false,
      error: `drafts lookup (league_id) failed: ${draftLookupError.message}. Confirm drafts.league_id exists (003_leagues.sql).`,
    };
  }

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
        .select("*")
        .single();

      if (updateError || !updated) {
        return {
          ok: false,
          error: `drafts league_id backfill failed: ${updateError?.message ?? "unknown error"}`,
        };
      }
      draft = updated;
    } else {
      const { data: existingDraft, error: existingError } = await supabase
        .from("drafts")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingError) {
        return {
          ok: false,
          error: `drafts lookup (user_id) failed: ${existingError.message}`,
        };
      }

      if (existingDraft) {
        const { data: reassigned, error: reassignError } = await supabase
          .from("drafts")
          .update({ league_id: league.id })
          .eq("id", existingDraft.id)
          .select("*")
          .single();

        if (reassignError || !reassigned) {
          return {
            ok: false,
            error: `drafts league_id reassignment failed: ${reassignError?.message ?? "unknown error"}`,
          };
        }
        draft = reassigned;
      } else {
        const { data: created, error: insertError } = await supabase
          .from("drafts")
          .insert({ user_id: userId, league_id: league.id })
          .select("*")
          .single();

        if (insertError || !created) {
          return {
            ok: false,
            error: `drafts insert failed: ${insertError?.message ?? "unknown error"}. Confirm 002_draft.sql ran and unique(user_id) was dropped by 003_leagues.sql.`,
          };
        }
        draft = created;
      }
    }
  }

  const { data: picks } = await supabase
    .from("draft_picks")
    .select("*")
    .eq("draft_id", draft.id)
    .order("pick_order", { ascending: true });

  const buyerCounts = await fetchBuyerCounts(supabase, league.id);
  const pickList = (picks ?? []) as DraftPick[];
  const draftRow = draft as Draft;
  const summary = summarizePicks(pickList);
  const turn = getTurn(draftRow, pickList);
  const leagueOffBoardSet = await getLeagueOffBoardSymbols(league.id);
  const myStockSymbols = [...getMyDraftedSymbols(pickList)].filter(
    (s) => !isCryptoSymbol(s)
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
    },
  };
}

export async function processPushbackSkip(userId: string) {
  const state = await loadDraftState(userId);
  if (!state) return { error: "Could not load draft" };

  const { draft, picks } = state;
  if (state.turn.type !== "pushback_skip") {
    return { error: "No pushback skip to process" };
  }

  const supabase = await createClient();
  const pickOrder = picks.length;
  const nextRound = getNextRoundAfterPick(draft, picks, "skip");

  const { error: pickError } = await supabase.from("draft_picks").insert({
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
  });

  if (pickError) return { error: pickError.message };

  const { error: draftError } = await supabase
    .from("drafts")
    .update({
      current_round: nextRound,
      pushback_skips_remaining: Math.max(0, draft.pushback_skips_remaining - 1),
    })
    .eq("id", draft.id);

  if (draftError) return { error: draftError.message };

  return { success: true };
}

export async function makeDraftPick(
  userId: string,
  symbol: string,
  allocation?: number,
  price?: number,
  isSearchPick = false
) {
  const state = await loadDraftState(userId);
  if (!state) return { error: "Could not load draft" };

  const { draft, picks, turn, buyerCounts, leagueId, leagueOffBoard } = state;
  if (draft.status === "complete" || turn.type === "complete") {
    return { error: "Draft is already complete" };
  }

  if (turn.type === "pushback_skip") {
    return { error: "Pushback skip must be processed first" };
  }

  const upperSymbol = symbol.toUpperCase();
  const myDrafted = getMyDraftedSymbols(picks);
  if (myDrafted.has(upperSymbol)) {
    return { error: `${upperSymbol} is already on your roster` };
  }

  const supabase = await createClient();
  const summary = summarizePicks(picks);
  const pickOrder = picks.length;
  let pickType: DraftPick["pick_type"] = "stock";
  let budgetSpent = 0;
  let shares = 0;
  let surchargePercent = 0;
  let effectiveValue = 0;
  const priceAtPick = price ?? 0;
  let pushbackDelta = 0;

  if (isCryptoSymbol(upperSymbol)) {
    if (!turn.canPickCrypto) {
      return { error: "Crypto picks are not available this round" };
    }

    const cryptoAmount = allocation ?? summary.cryptoRemaining;
    if (cryptoAmount <= 0 || cryptoAmount > summary.cryptoRemaining) {
      return { error: "Invalid crypto allocation" };
    }

    if (!priceAtPick || priceAtPick <= 0) {
      return { error: "Missing price for crypto pick" };
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

    if (draft.current_round <= STOCK_ROUNDS) {
      const existingEarlyCrypto = picks.filter(
        (p) => p.pick_type === "crypto" && p.round_number <= STOCK_ROUNDS
      );
      const afterPick = [
        ...existingEarlyCrypto,
        { budget_spent: budgetSpent } as DraftPick,
      ];
      const newTotal = afterPick.reduce((s, p) => s + p.budget_spent, 0);
      if (newTotal >= CRYPTO_POOL) {
        pushbackDelta = calculatePushback(afterPick as DraftPick[]);
      }
    }
  } else if (turn.type === "bench") {
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
  } else if (turn.type === "stock") {
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

  const { error: pickError } = await supabase.from("draft_picks").insert({
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
  });

  if (pickError) return { error: pickError.message };

  const updatedPicks = [
    ...picks,
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

  return { success: true, complete };
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

  const earlyCrypto = cleaned.filter(
    (p) => p.pick_type === "crypto" && p.round_number <= STOCK_ROUNDS
  );
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

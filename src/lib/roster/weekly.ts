import { loadDraftStateDetailed } from "@/lib/draft/server";
import type { DraftPick } from "@/lib/draft/types";
import { createClient } from "@/lib/supabase/server";
import {
  fetchStockQuotes,
  getCryptoQuotesMap,
} from "@/lib/roster/quotes";
import { isCryptoSymbol } from "@/lib/draft/engine";
import type { CryptoQuote } from "@/lib/coingecko/service";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export function pickMarketValue(pick: DraftPick, price: number): number {
  if (price <= 0) return 0;
  return pick.shares * price;
}

async function fetchPricesForPicks(
  picks: DraftPick[]
): Promise<Map<string, number>> {
  const stockSymbols = picks
    .filter((p) => !isCryptoSymbol(p.symbol))
    .map((p) => p.symbol);
  const needsCrypto = picks.some((p) => isCryptoSymbol(p.symbol));

  const [stockQuotes, cryptoQuotes] = await Promise.all([
    fetchStockQuotes(stockSymbols),
    needsCrypto
      ? getCryptoQuotesMap()
      : Promise.resolve({} as Record<string, CryptoQuote>),
  ]);

  const draftPriceBySymbol = new Map<string, number>();
  for (const pick of picks) {
    const symbol = pick.symbol.toUpperCase();
    if (pick.price_at_pick > 0 && !draftPriceBySymbol.has(symbol)) {
      draftPriceBySymbol.set(symbol, pick.price_at_pick);
    }
  }

  const prices = new Map<string, number>();
  for (const pick of picks) {
    const symbol = pick.symbol.toUpperCase();
    if (prices.has(symbol)) continue;

    if (isCryptoSymbol(symbol)) {
      const livePrice = cryptoQuotes[symbol]?.price ?? 0;
      prices.set(
        symbol,
        livePrice > 0 ? livePrice : (draftPriceBySymbol.get(symbol) ?? 0)
      );
    } else {
      prices.set(symbol, stockQuotes.get(symbol)?.price ?? 0);
    }
  }

  return prices;
}

export async function getCurrentWeek(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string
): Promise<number> {
  const { data } = await supabase
    .from("league_standings")
    .select("current_week")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  return data?.current_week ?? 1;
}

export async function loadWeekBaselineMap(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("roster_week_baselines")
    .select("pick_id, value_at_open")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("week_number", weekNumber);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [row.pick_id, Number(row.value_at_open)])
  );
}

export async function captureWeekBaselinesForUser(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number
): Promise<void> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return;

  const picks = state.state.picks.filter((p) => p.pick_type !== "skip");
  const prices = await fetchPricesForPicks(picks);

  const rows = picks.map((pick) => ({
    league_id: leagueId,
    user_id: userId,
    week_number: weekNumber,
    pick_id: pick.id,
    value_at_open: pickMarketValue(
      pick,
      prices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick
    ),
  }));

  if (rows.length === 0) return;

  await supabase.from("roster_week_baselines").upsert(rows, {
    onConflict: "league_id,user_id,week_number,pick_id",
  });
}

export async function captureWeekBaselinesForLeague(
  leagueId: string,
  weekNumber: number
): Promise<void> {
  const supabase = await createClient();
  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId);

  for (const draft of drafts ?? []) {
    await captureWeekBaselinesForUser(
      supabase,
      leagueId,
      draft.user_id,
      weekNumber
    );
  }
}

export async function ensureWeekBaselines(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number,
  picks: DraftPick[]
): Promise<Map<string, number>> {
  let baselineMap = await loadWeekBaselineMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );

  const activePickIds = new Set(picks.map((p) => p.id));
  const hasAllBaselines =
    picks.length > 0 && picks.every((pick) => baselineMap.has(pick.id));

  if (!hasAllBaselines) {
    await captureWeekBaselinesForUser(supabase, leagueId, userId, weekNumber);
    baselineMap = await loadWeekBaselineMap(
      supabase,
      leagueId,
      userId,
      weekNumber
    );
  }

  for (const pickId of [...baselineMap.keys()]) {
    if (!activePickIds.has(pickId)) {
      baselineMap.delete(pickId);
    }
  }

  return baselineMap;
}

export async function setPickWeekBaseline(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number,
  pickId: string,
  valueAtOpen: number
): Promise<void> {
  await supabase.from("roster_week_baselines").upsert(
    {
      league_id: leagueId,
      user_id: userId,
      week_number: weekNumber,
      pick_id: pickId,
      value_at_open: valueAtOpen,
    },
    { onConflict: "league_id,user_id,week_number,pick_id" }
  );
}

export async function adjustPickWeekBaseline(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number,
  pickId: string,
  delta: number
): Promise<void> {
  const baselineMap = await loadWeekBaselineMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );
  const current = baselineMap.get(pickId) ?? 0;
  await setPickWeekBaseline(
    supabase,
    leagueId,
    userId,
    weekNumber,
    pickId,
    Math.max(0, current + delta)
  );
}

export async function applyIrSwapWeekBaselines(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  promotedPickId: string,
  transferBudget: number
): Promise<void> {
  const weekNumber = await getCurrentWeek(supabase, leagueId, userId);
  await setPickWeekBaseline(
    supabase,
    leagueId,
    userId,
    weekNumber,
    promotedPickId,
    transferBudget
  );
}

export async function applyCryptoRebalanceWeekBaselines(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  sourcePickId: string,
  targetPickId: string | null,
  sellFraction: number,
  soldBudget: number,
  buyBudget: number,
  isNewTarget: boolean
): Promise<void> {
  const weekNumber = await getCurrentWeek(supabase, leagueId, userId);
  const baselineMap = await loadWeekBaselineMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );

  const sourceOpen = baselineMap.get(sourcePickId) ?? soldBudget / sellFraction;
  const remainingSourceOpen = Math.max(0, sourceOpen * (1 - sellFraction));
  await setPickWeekBaseline(
    supabase,
    leagueId,
    userId,
    weekNumber,
    sourcePickId,
    remainingSourceOpen
  );

  if (!targetPickId) return;

  if (isNewTarget) {
    await setPickWeekBaseline(
      supabase,
      leagueId,
      userId,
      weekNumber,
      targetPickId,
      buyBudget
    );
    return;
  }

  const targetOpen = baselineMap.get(targetPickId) ?? 0;
  await setPickWeekBaseline(
    supabase,
    leagueId,
    userId,
    weekNumber,
    targetPickId,
    targetOpen + soldBudget
  );
}

export function computeWeekDollarGain(
  currentValue: number,
  valueAtOpen: number
): number {
  return currentValue - valueAtOpen;
}

export function computeScoringWeekGainPercent(
  scoringPicks: Array<{ currentValue: number; weekOpenValue: number }>
): number {
  let openTotal = 0;
  let currentTotal = 0;

  for (const pick of scoringPicks) {
    openTotal += pick.weekOpenValue;
    currentTotal += pick.currentValue;
  }

  if (openTotal <= 0) return 0;
  return ((currentTotal - openTotal) / openTotal) * 100;
}

export async function computeScoringWeekGainPercentForUser(
  userId: string,
  leagueId: string
): Promise<number> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return 0;

  const supabase = await createClient();
  const weekNumber = await getCurrentWeek(supabase, leagueId, userId);
  const picks = state.state.picks.filter((p) => p.pick_type !== "skip");
  const baselineMap = await ensureWeekBaselines(
    supabase,
    leagueId,
    userId,
    weekNumber,
    picks
  );
  const prices = await fetchPricesForPicks(picks);

  const scoringInputs = picks
    .filter((p) => p.pick_type === "stock" || p.pick_type === "crypto")
    .map((pick) => {
      const price =
        prices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick;
      const currentValue = pickMarketValue(pick, price);
      const weekOpenValue =
        baselineMap.get(pick.id) ?? pickMarketValue(pick, price);

      return { currentValue, weekOpenValue };
    });

  return computeScoringWeekGainPercent(scoringInputs);
}

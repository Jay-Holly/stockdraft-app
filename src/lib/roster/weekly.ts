import { loadDraftStateDetailed } from "@/lib/draft/server";
import type { DraftPick } from "@/lib/draft/types";
import { createClient } from "@/lib/supabase/server";
import {
  fetchStockQuotes,
  getCryptoQuotesMap,
} from "@/lib/roster/quotes";
import { isCryptoSymbol } from "@/lib/draft/engine";
import type { CryptoQuote } from "@/lib/coingecko/service";
import { computeScoringWeekGainPercent } from "@/lib/roster/scoring-math";
import {
  baselinesHaveFridayClose,
  fetchLivePricesForPicks,
  resolveHybridScoringValue,
  type WeekBaselineRow,
} from "@/lib/season/weekend-scoring";
import { isPastFinalizeAt } from "@/lib/season/finalize-times";
import { loadSeasonCalendarForLeague } from "@/lib/season/settings-server";
import type { SeasonSettings } from "@/lib/season/types";

export { computeScoringWeekGainPercent } from "@/lib/roster/scoring-math";

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
  const extended = await loadWeekBaselineExtendedMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );
  return new Map(
    [...extended.entries()].map(([pickId, row]) => [pickId, row.valueAtOpen])
  );
}

export async function loadWeekBaselineExtendedMap(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number
): Promise<Map<string, WeekBaselineRow>> {
  const { data, error } = await supabase
    .from("roster_week_baselines")
    .select("pick_id, value_at_open, stock_value_at_friday_close")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("week_number", weekNumber);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [
      row.pick_id,
      {
        valueAtOpen: Number(row.value_at_open),
        stockValueAtFridayClose:
          row.stock_value_at_friday_close != null
            ? Number(row.stock_value_at_friday_close)
            : null,
      },
    ])
  );
}

async function getWeekFinalizeAtForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number
): Promise<string | null> {
  const { data } = await supabase
    .from("league_matchups")
    .select("finalize_at")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .not("finalize_at", "is", null)
    .limit(1)
    .maybeSingle();

  return data?.finalize_at ?? null;
}

async function shouldUseHybridScoring(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number,
  settings: SeasonSettings,
  baselineMap: Map<string, WeekBaselineRow>,
  now: Date,
  forceHybrid?: boolean
): Promise<boolean> {
  if (forceHybrid) return baselinesHaveFridayClose(baselineMap);
  if (!settings.rulesApply) return false;
  if (!baselinesHaveFridayClose(baselineMap)) return false;

  const finalizeAt = await getWeekFinalizeAtForLeague(
    supabase,
    leagueId,
    weekNumber
  );
  if (finalizeAt && isPastFinalizeAt(finalizeAt, now)) return false;

  return true;
}

async function loadUserDraftPicks(
  supabase: SupabaseClient,
  userId: string,
  leagueId: string
): Promise<DraftPick[]> {
  const { data: draft } = await supabase
    .from("drafts")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!draft?.id) return [];

  const { data: picks } = await supabase
    .from("draft_picks")
    .select("*")
    .eq("draft_id", draft.id)
    .order("pick_order", { ascending: true });

  return (picks ?? []) as DraftPick[];
}

async function computeScoringWeekInputs(
  userId: string,
  leagueId: string,
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: SupabaseClient;
  }
): Promise<
  Array<{ currentValue: number; weekOpenValue: number }>
> {
  const supabase = options?.supabase ?? (await createClient());

  let picks: DraftPick[];
  if (options?.supabase) {
    picks = (await loadUserDraftPicks(supabase, userId, leagueId)).filter(
      (p) => p.pick_type !== "skip"
    );
  } else {
    const state = await loadDraftStateDetailed(userId, { leagueId });
    if (!state.ok) return [];
    picks = state.state.picks.filter((p) => p.pick_type !== "skip");
  }

  if (picks.length === 0) return [];

  const weekNumber =
    options?.weekNumber ??
    (await getCurrentWeek(supabase, leagueId, userId));

  await ensureWeekBaselines(supabase, leagueId, userId, weekNumber, picks);

  const refreshedBaselines = await loadWeekBaselineExtendedMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );

  const { settings } = await loadSeasonCalendarForLeague(leagueId);
  const now = options?.at ?? new Date();
  const useHybrid = await shouldUseHybridScoring(
    supabase,
    leagueId,
    weekNumber,
    settings,
    refreshedBaselines,
    now,
    options?.forceHybrid
  );

  const livePrices = await fetchLivePricesForPicks(picks);

  return picks
    .filter((p) => p.pick_type === "stock" || p.pick_type === "crypto")
    .map((pick) => {
      const baseline = refreshedBaselines.get(pick.id);
      const weekOpenValue =
        baseline?.valueAtOpen ??
        pickMarketValue(
          pick,
          livePrices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick
        );
      const currentValue = resolveHybridScoringValue(
        pick,
        livePrices,
        baseline,
        useHybrid
      );

      return { currentValue, weekOpenValue };
    });
}

export async function captureFridayStockCloseForUser(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number
): Promise<void> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return;

  const stockPicks = state.state.picks.filter(
    (p) => p.pick_type === "stock" || p.pick_type === "bench"
  );
  if (stockPicks.length === 0) return;

  const livePrices = await fetchLivePricesForPicks(stockPicks);

  for (const pick of stockPicks) {
    if (pick.pick_type !== "stock" && pick.symbol.toUpperCase() === "__OPEN__") {
      continue;
    }
    if (pick.pick_type === "bench" && pick.symbol.toUpperCase() === "__OPEN__") {
      continue;
    }

    const closeValue = pickMarketValue(
      pick,
      livePrices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick
    );

    const { data: existing } = await supabase
      .from("roster_week_baselines")
      .select("value_at_open")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .eq("week_number", weekNumber)
      .eq("pick_id", pick.id)
      .maybeSingle();

    await supabase.from("roster_week_baselines").upsert(
      {
        league_id: leagueId,
        user_id: userId,
        week_number: weekNumber,
        pick_id: pick.id,
        value_at_open: existing?.value_at_open ?? closeValue,
        stock_value_at_friday_close: closeValue,
      },
      { onConflict: "league_id,user_id,week_number,pick_id" }
    );
  }
}

export async function captureFridayStockCloseForLeague(
  leagueId: string,
  weekNumber: number,
  supabaseClient?: SupabaseClient
): Promise<{ captured: boolean }> {
  const supabase = supabaseClient ?? (await createClient());
  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId);

  for (const draft of drafts ?? []) {
    await captureFridayStockCloseForUser(
      supabase,
      leagueId,
      draft.user_id,
      weekNumber
    );
  }

  await supabase
    .from("league_matchups")
    .update({ stock_close_captured_at: new Date().toISOString() })
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "scheduled");

  return { captured: true };
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
  weekNumber: number,
  supabaseClient?: SupabaseClient
): Promise<void> {
  const supabase = supabaseClient ?? (await createClient());
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

export async function captureWeekCloseSnapshots(
  leagueId: string,
  weekNumber: number,
  supabaseOverride?: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  const supabase = supabaseOverride ?? (await createClient());
  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId);

  for (const draft of drafts ?? []) {
    const state = await loadDraftStateDetailed(draft.user_id, { leagueId });
    if (!state.ok) continue;

    const picks = state.state.picks.filter((pick) => pick.pick_type !== "skip");
    const prices = await fetchPricesForPicks(picks);

    for (const pick of picks) {
      const closeValue = pickMarketValue(
        pick,
        prices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick
      );

      const { data: existing } = await supabase
        .from("roster_week_baselines")
        .select("value_at_open")
        .eq("league_id", leagueId)
        .eq("user_id", draft.user_id)
        .eq("week_number", weekNumber)
        .eq("pick_id", pick.id)
        .maybeSingle();

      await supabase.from("roster_week_baselines").upsert(
        {
          league_id: leagueId,
          user_id: draft.user_id,
          week_number: weekNumber,
          pick_id: pick.id,
          value_at_open: existing?.value_at_open ?? closeValue,
          value_at_close: closeValue,
        },
        { onConflict: "league_id,user_id,week_number,pick_id" }
      );
    }
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

export function computeWeekGainPercent(
  currentValue: number,
  valueAtOpen: number
): number {
  if (valueAtOpen <= 0) return 0;
  return ((currentValue - valueAtOpen) / valueAtOpen) * 100;
}

export async function computeScoringWeekGainPercentForUser(
  userId: string,
  leagueId: string,
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: SupabaseClient;
  }
): Promise<number> {
  const scoringInputs = await computeScoringWeekInputs(userId, leagueId, options);
  return computeScoringWeekGainPercent(scoringInputs);
}

export async function computeScoringWeekDollarGainForUser(
  userId: string,
  leagueId: string,
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: SupabaseClient;
  }
): Promise<number> {
  const scoringInputs = await computeScoringWeekInputs(userId, leagueId, options);
  let total = 0;
  for (const pick of scoringInputs) {
    total += computeWeekDollarGain(pick.currentValue, pick.weekOpenValue);
  }
  return total;
}

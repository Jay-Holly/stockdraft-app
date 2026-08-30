import { loadDraftStateDetailed } from "@/lib/draft/server";
import type { DraftPick } from "@/lib/draft/types";
import { createClient } from "@/lib/supabase/server";
import {
  fetchStockQuotes,
  getCryptoQuotesMap,
} from "@/lib/roster/quotes";
import { isCryptoSymbol } from "@/lib/draft/engine";
import type { CryptoQuote } from "@/lib/coingecko/service";
import {
  computePickSeasonMetrics,
  computeTeamSeasonMetrics,
  loadBaselinesThroughWeek,
} from "@/lib/roster/season-totals";
import {
  baselinesHaveFridayClose,
  fetchLivePricesForPicks,
  resolveHybridScoringValue,
  type WeekBaselineRow,
} from "@/lib/season/weekend-scoring";
import { isPastFinalizeAt } from "@/lib/season/finalize-times";
import { loadSeasonCalendarForLeague } from "@/lib/season/settings-server";
import { loadInjuredSymbolsForLeague } from "@/lib/sim/injury-eligibility-dispatch";
import { isMultiAssetSimLeague } from "@/lib/season/sdpl-league";
import type { SeasonSettings } from "@/lib/season/types";
import {
  computePickMarketValue,
  isTrustworthyValue,
  captureOpeningValues,
  captureClosingValues,
} from "@/lib/scoring/canonical";

export {
  computeScoringWeekGainPercent,
  computeWeekDollarGain,
  computeWeekGainPercent,
} from "@/lib/roster/scoring-math";
import { computeScoringWeekGainPercent, computeWeekDollarGain } from "@/lib/roster/scoring-math";
import { easternDateIso } from "@/lib/dfs/audit-dates";
import {
  fetchDailyOpenClose,
  hasTwelveDataKey,
  isTwelveDataSupported,
  TWELVE_DATA_CREDITS_PER_MINUTE,
} from "@/lib/market/twelve-data";
import {
  addBudgetToBaselineValues,
  initialBaselineValues,
  scaleBaselineValuesForPartialSell,
} from "@/lib/roster/baseline-rebalance";
import {
  canonicalActiveCryptoPicks,
  filterScoringRosterPicks,
  picksEligibleForWeekBaselines,
  isActiveCryptoPick,
  staleDuplicateCryptoPickIds,
} from "@/lib/roster/crypto-picks";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Delegated to canonical module — imported as computePickMarketValue, isTrustworthyValue
export function pickMarketValue(pick: DraftPick, price: number): number {
  return computePickMarketValue(pick, price);
}

export function isTrustworthyBaselineValue(pick: DraftPick, value: number): boolean {
  return isTrustworthyValue(pick, value);
}

export async function fetchPricesForPicks(
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

  // A failed quote must leave the symbol absent, never substitute the
  // draft-day price. Substituting produces a real-looking number that passes
  // every downstream guard and then gets persisted as a baseline, silently
  // scoring the week against a months-old price. Callers that persist must
  // skip a missing symbol; callers that only display may fall back themselves.
  const prices = new Map<string, number>();
  for (const pick of picks) {
    const symbol = pick.symbol.toUpperCase();
    if (prices.has(symbol)) continue;

    const livePrice = isCryptoSymbol(symbol)
      ? (cryptoQuotes[symbol]?.price ?? 0)
      : (stockQuotes.get(symbol)?.price ?? 0);

    if (livePrice > 0) prices.set(symbol, livePrice);
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

/**
 * True when `weekNumber` has actually begun for this league, i.e. it is at or
 * behind the league's current week. Baselines for a future week are a
 * look-ahead artifact, not data — see captureWeekBaselinesForUser.
 */
export async function isWeekOpenForBaselines(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number
): Promise<boolean> {
  const { data } = await supabase
    .from("leagues")
    .select("current_week")
    .eq("id", leagueId)
    .maybeSingle();

  // No league row means no authority to judge; leave existing behaviour alone
  // rather than silently dropping a legitimate capture.
  if (!data) return true;
  return weekNumber <= (data.current_week ?? 1);
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
    .select("pick_id, value_at_open, value_at_close, stock_value_at_friday_close")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("week_number", weekNumber);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [
      row.pick_id,
      {
        valueAtOpen: Number(row.value_at_open),
        valueAtClose:
          row.value_at_close != null ? Number(row.value_at_close) : null,
        stockValueAtFridayClose:
          row.stock_value_at_friday_close != null
            ? Number(row.stock_value_at_friday_close)
            : null,
      },
    ])
  );
}

/**
 * True when BOTH sides of a matchup have every funded position's close
 * identical to its cent, which means the close was never really captured for
 * either team — not that the market stood still for one of them.
 *
 * How that happens: refresh-stock-prices covers MAX_SYMBOLS_PER_RUN (240) of a
 * 503-stock pool per run, and Finnhub's free tier caps at 60 calls/minute, so
 * the live refresh inside captureWeekCloseSnapshots mostly comes back empty. A
 * failed quote correctly falls back to the cached price — but that is the same
 * cached price the week's open was taken from. Open and close come out equal,
 * the week scores 0.00 for both sides, and it finalizes as a winner-less tie.
 * 20 of 48 games in a fresh 32-team SDFL league landed that way.
 *
 * Checking BOTH sides matters: one manager can legitimately score a flat 0.00%
 * for the week (a roster that genuinely didn't move) while their opponent
 * scores a real number — that is an ordinary result, not a failed capture, and
 * an earlier version of this check that looked at either side alone would have
 * blocked it. A bogus tie only exists when neither side has any real movement
 * to compare against.
 *
 * Real markets do not leave a ten-position roster unchanged to the cent, so
 * treating this as a failed capture is safe. Callers should decline to
 * finalize and retry, exactly as they do for a roster that will not load — the
 * week finalizes normally once prices actually refresh.
 */
export async function weekMatchupLooksUncaptured(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number,
  homeUserId: string,
  awayUserId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("roster_week_baselines")
    .select("user_id, value_at_open, value_at_close")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .in("user_id", [homeUserId, awayUserId]);

  const isSideFrozen = (userId: string): boolean => {
    const rows = data?.filter((row) => row.user_id === userId) ?? [];
    if (rows.length === 0) return false;

    // Only positions that actually hold value can evidence a move; empty
    // slots are legitimately 0 open and 0 close.
    const funded = rows.filter(
      (row) => row.value_at_close != null && Number(row.value_at_open) > 0
    );

    // Too few positions to distinguish a stuck cache from a quiet week.
    if (funded.length < 3) return false;

    return funded.every(
      (row) =>
        Math.abs(Number(row.value_at_open) - Number(row.value_at_close)) <
        0.01
    );
  };

  return isSideFrozen(homeUserId) && isSideFrozen(awayUserId);
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
  Array<{ pickId: string; currentValue: number; weekOpenValue: number }>
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

  const scoringPicks = filterScoringRosterPicks(picks);

  const refreshedBaselines = await loadWeekBaselineExtendedMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );

  const { settings } = await loadSeasonCalendarForLeague(
    leagueId,
    options?.at ?? new Date(),
    supabase
  );
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

  const livePrices = await fetchLivePricesForPicks(scoringPicks);
  const injuredSymbols = await loadInjuredScoringSymbols(
    supabase,
    leagueId,
    scoringPicks,
    weekNumber
  );

  return scoringPicks.map((pick) => {
      const baseline = refreshedBaselines.get(pick.id);
      const weekOpenValue =
        baseline?.valueAtOpen ??
        pickMarketValue(pick, livePrices.get(pick.symbol.toUpperCase()) ?? 0);

      // An injured starter left in the lineup scores a zero — bench it or eat
      // it, same as fantasy football. Flat means it still occupies its share
      // of the roster (it stays in the denominator) but contributes no move.
      if (injuredSymbols.has(pick.symbol.toUpperCase())) {
        return { pickId: pick.id, currentValue: weekOpenValue, weekOpenValue };
      }

      const currentValue =
        !useHybrid &&
        baseline?.valueAtClose != null &&
        baseline.valueAtClose > 0 &&
        (pick.pick_type === "stock" || pick.pick_type === "crypto")
          ? baseline.valueAtClose
          : resolveHybridScoringValue(
              pick,
              livePrices,
              baseline,
              useHybrid
            );

      return { pickId: pick.id, currentValue, weekOpenValue };
    });
}

/**
 * Every injured symbol in a league for one week, resolved once and reused.
 *
 * Scoring runs per manager, so without this a 32-team week would repeat the
 * same three injury queries 32 times. The underlying data is a finished real
 * season keyed by league and week, so it cannot change under us and is safe
 * to hold for the life of the process.
 */
const injuredSymbolCache = new Map<string, Promise<Set<string>>>();

function loadLeagueInjuredSymbols(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number
): Promise<Set<string>> {
  const key = `${leagueId}:${weekNumber}`;
  const cached = injuredSymbolCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const { data: league } = await supabase
      .from("leagues")
      .select("format_type, sports_league_id, sports_standings_season")
      .eq("id", leagueId)
      .maybeSingle();

    if (!league || league.format_type !== "sports_league") return new Set<string>();
    if (isMultiAssetSimLeague(league.sports_league_id)) return new Set<string>();

    // Resolve the league's whole injury map for the week, not just this
    // roster — every manager's lookup then answers from memory.
    const { data: mapRows } = await supabase
      .from("sim_league_pick_injury_map")
      .select("symbol")
      .eq("league_id", leagueId);

    const allSymbols = [
      ...new Set((mapRows ?? []).map((row) => String(row.symbol).toUpperCase())),
    ];
    if (allSymbols.length === 0) return new Set<string>();

    return loadInjuredSymbolsForLeague(
      supabase,
      leagueId,
      league,
      allSymbols,
      weekNumber
    );
  })();

  injuredSymbolCache.set(key, pending);
  return pending;
}

/**
 * Symbols in this roster whose mapped real player is injured this week.
 * Empty for anything that is not a sports-sim league with an injury map, so
 * SDPL/SDAI and the free-stash multi-asset leagues are unaffected.
 */
async function loadInjuredScoringSymbols(
  supabase: SupabaseClient,
  leagueId: string,
  scoringPicks: DraftPick[],
  weekNumber: number
): Promise<Set<string>> {
  const symbols = scoringPicks
    .filter((pick) => pick.pick_type === "stock")
    .map((pick) => pick.symbol.toUpperCase())
    .filter((symbol) => symbol !== "__OPEN__");

  if (symbols.length === 0) return new Set();

  const leagueInjured = await loadLeagueInjuredSymbols(
    supabase,
    leagueId,
    weekNumber
  );
  if (leagueInjured.size === 0) return new Set();

  return new Set(symbols.filter((symbol) => leagueInjured.has(symbol)));
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
      livePrices.get(pick.symbol.toUpperCase()) ?? 0
    );

    if (!isTrustworthyBaselineValue(pick, closeValue)) continue;

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
  // A week that hasn't started has no opening line to record. The roster page
  // lets a manager look ahead to any scheduled week, and that read used to
  // fall through to here and persist an opening baseline priced at today —
  // so simply viewing week 10 in week 1 froze week 10's open months early,
  // and the "never overwrite an existing open" rule then made it permanent.
  if (!(await isWeekOpenForBaselines(supabase, leagueId, weekNumber))) return;

  let picks = (await loadUserDraftPicks(supabase, userId, leagueId)).filter(
    (p) => p.pick_type !== "skip"
  );

  if (picks.length === 0) {
    const state = await loadDraftStateDetailed(userId, { leagueId });
    if (!state.ok) return;
    picks = state.state.picks.filter((p) => p.pick_type !== "skip");
  }

  if (picks.length === 0) return;

  picks = picksEligibleForWeekBaselines(picks);

  if (picks.length === 0) return;

  // A week's open MUST equal the prior week's close when one exists —
  // otherwise season/weekly math (which sums per-week close-minus-open
  // deltas) silently drops or fabricates gains at every gap. This path runs
  // opportunistically on page visits and used to always live-price the open,
  // racing captureWeekBaselinesForUserCarryingForward's calendar-driven
  // carry-forward and frequently winning (upsert ignoreDuplicates means
  // whichever writes first sticks). Checking the prior week's close first
  // makes both paths agree regardless of which one runs first.
  let priorCloseByPick = new Map<string, number>();
  if (weekNumber > 1) {
    const { data: priorRows } = await supabase
      .from("roster_week_baselines")
      .select("pick_id, value_at_close")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .eq("week_number", weekNumber - 1);

    priorCloseByPick = new Map(
      (priorRows ?? [])
        .filter((row) => row.value_at_close != null)
        .map((row) => [row.pick_id as string, Number(row.value_at_close)])
    );
  }

  const picksNeedingLivePrice = picks.filter(
    (pick) => !priorCloseByPick.has(pick.id)
  );
  const prices =
    picksNeedingLivePrice.length > 0
      ? await fetchPricesForPicks(picksNeedingLivePrice)
      : new Map<string, number>();

  await captureOpeningValues(
    supabase,
    {
      table: "roster_week_baselines",
      leagueId,
      userId,
      weekNumber,
    },
    picks.map((pick) => ({
      pick,
      priorClose: priorCloseByPick.get(pick.id) ?? null,
      livePrice: prices.get(pick.symbol.toUpperCase()) ?? null,
    }))
  );
}

// Caps how many managers' DB round trips run at once during the bulk
// league-wide capture below. Unbounded Promise.all across a full 32-team
// league fired every capture concurrently from a single request (e.g.
// right as a draft finishes), bursting Postgres load hard enough to
// saturate Supabase and trip the auth middleware's timeout for everyone.
const WEEK_BASELINE_CAPTURE_CONCURRENCY = 6;

async function runWithConcurrencyCap<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  async function runNext(): Promise<void> {
    const index = cursor++;
    if (index >= items.length) return;
    await worker(items[index]);
    await runNext();
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runNext)
  );
}

/**
 * Bulk version of captureWeekBaselinesForUser for an entire league at once
 * (draft-finish, week rollover, etc.) — everyone in a league is about to
 * hit their own team page within seconds of each other, so staggering by
 * priority only decides who's last, it doesn't make the batch fast.
 *
 * Instead this fetches live prices for the league's whole deduplicated
 * symbol set ONCE (a stock-draft pool has heavy overlap across managers),
 * instead of each manager separately re-fetching quotes for their own
 * picks. That's the actual bottleneck this replaces: 32 external
 * quote-provider calls collapse into one. Per-user DB reads/writes still
 * run concurrency-capped, and priorityUserId (e.g. the draft-completing
 * owner) still goes first within that cap as a tie-breaker.
 */
export async function captureWeekBaselinesForLeague(
  leagueId: string,
  weekNumber: number,
  supabaseClient?: SupabaseClient,
  priorityUserId?: string | null
): Promise<void> {
  const supabase = supabaseClient ?? (await createClient());
  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId);

  if (!drafts?.length) return;

  // This gets called on every matchups/league page visit for every league
  // the user belongs to, but a week's baselines only need real work once —
  // after that this is a cheap count check instead of N live quote fetches.
  const { data: existingRows } = await supabase
    .from("roster_week_baselines")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  const coveredUserIds = new Set((existingRows ?? []).map((row) => row.user_id));
  const uncoveredDrafts = drafts.filter(
    (draft) => !coveredUserIds.has(draft.user_id)
  );
  if (uncoveredDrafts.length === 0) return;

  if (!(await isWeekOpenForBaselines(supabase, leagueId, weekNumber))) return;

  if (priorityUserId) {
    uncoveredDrafts.sort((a, b) => {
      if (a.user_id === priorityUserId) return -1;
      if (b.user_id === priorityUserId) return 1;
      return 0;
    });
  }

  type PendingCapture = {
    userId: string;
    picks: DraftPick[];
    priorCloseByPick: Map<string, number>;
  };

  const pending: PendingCapture[] = [];

  // Pass 1: figure out per-user picks + what already carries forward from
  // last week's close, without touching the quote provider yet.
  await runWithConcurrencyCap(
    uncoveredDrafts,
    WEEK_BASELINE_CAPTURE_CONCURRENCY,
    async (draft) => {
      let picks = (
        await loadUserDraftPicks(supabase, draft.user_id, leagueId)
      ).filter((p) => p.pick_type !== "skip");

      if (picks.length === 0) {
        const state = await loadDraftStateDetailed(draft.user_id, {
          leagueId,
        });
        if (!state.ok) return;
        picks = state.state.picks.filter((p) => p.pick_type !== "skip");
      }

      picks = picksEligibleForWeekBaselines(picks);
      if (picks.length === 0) return;

      let priorCloseByPick = new Map<string, number>();
      if (weekNumber > 1) {
        const { data: priorRows } = await supabase
          .from("roster_week_baselines")
          .select("pick_id, value_at_close")
          .eq("league_id", leagueId)
          .eq("user_id", draft.user_id)
          .eq("week_number", weekNumber - 1);

        priorCloseByPick = new Map(
          (priorRows ?? [])
            .filter((row) => row.value_at_close != null)
            .map((row) => [row.pick_id as string, Number(row.value_at_close)])
        );
      }

      pending.push({ userId: draft.user_id, picks, priorCloseByPick });
    }
  );

  if (pending.length === 0) return;

  // One shared fetch for every symbol anyone in the league still needs a
  // live price for, deduplicated — this is the actual burst this replaces.
  const picksNeedingLivePrice: DraftPick[] = [];
  const seenSymbols = new Set<string>();
  for (const entry of pending) {
    for (const pick of entry.picks) {
      if (entry.priorCloseByPick.has(pick.id)) continue;
      const symbol = pick.symbol.toUpperCase();
      if (seenSymbols.has(symbol)) continue;
      seenSymbols.add(symbol);
      picksNeedingLivePrice.push(pick);
    }
  }

  const prices =
    picksNeedingLivePrice.length > 0
      ? await fetchPricesForPicks(picksNeedingLivePrice)
      : new Map<string, number>();

  // Pass 2: cheap, price-free writes — safe to run concurrency-capped.
  await runWithConcurrencyCap(
    pending,
    WEEK_BASELINE_CAPTURE_CONCURRENCY,
    (entry) =>
      captureOpeningValues(
        supabase,
        {
          table: "roster_week_baselines",
          leagueId,
          userId: entry.userId,
          weekNumber,
        },
        entry.picks.map((pick) => ({
          pick,
          priorClose: entry.priorCloseByPick.get(pick.id) ?? null,
          livePrice: prices.get(pick.symbol.toUpperCase()) ?? null,
        }))
      )
  );
}

async function captureWeekBaselinesForUserCarryingForward(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number,
  priorWeekNumber: number
): Promise<void> {
  const { data: priorRows } = await supabase
    .from("roster_week_baselines")
    .select("pick_id, value_at_close")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("week_number", priorWeekNumber);

  const priorCloseByPick = new Map(
    (priorRows ?? [])
      .filter((row) => row.value_at_close != null)
      .map((row) => [row.pick_id as string, Number(row.value_at_close)])
  );

  let picks = (await loadUserDraftPicks(supabase, userId, leagueId)).filter(
    (p) => p.pick_type !== "skip"
  );

  if (picks.length === 0) {
    const state = await loadDraftStateDetailed(userId, { leagueId });
    if (!state.ok) return;
    picks = state.state.picks.filter((p) => p.pick_type !== "skip");
  }

  if (picks.length === 0) return;

  picks = picksEligibleForWeekBaselines(picks);
  if (picks.length === 0) return;

  // Picks with no prior-week close (newly acquired via waiver/IR, or the
  // prior week's own close never got captured) still need a live price.
  const picksNeedingLivePrice = picks.filter(
    (pick) => !priorCloseByPick.has(pick.id)
  );
  const livePrices =
    picksNeedingLivePrice.length > 0
      ? await fetchPricesForPicks(picksNeedingLivePrice)
      : new Map<string, number>();

  await captureOpeningValues(
    supabase,
    {
      table: "roster_week_baselines",
      leagueId,
      userId,
      weekNumber,
    },
    picks.map((pick) => ({
      pick,
      priorClose: priorCloseByPick.get(pick.id) ?? null,
      livePrice: livePrices.get(pick.symbol.toUpperCase()) ?? null,
    }))
  );
}

/**
 * Same as captureWeekBaselinesForLeague, but a new week's open value is
 * carried forward from the prior week's close instead of an independent
 * live-quote fetch. Matters when a cron catches up multiple overdue weeks
 * in one run: capturing week N+1's open via a fresh fetch mere moments
 * before also scoring week N+1 (using another fresh fetch as "current")
 * guarantees a near-identical open/current pair — a ~0% score regardless
 * of what actually happened that week. Reusing week N's close as week
 * N+1's open is correct regardless of timing (this week's start price is
 * last week's end price) and eliminates the coincidental-match failure
 * mode entirely.
 */
export async function captureWeekBaselinesForLeagueCarryingForward(
  leagueId: string,
  weekNumber: number,
  priorWeekNumber: number,
  supabaseClient?: SupabaseClient
): Promise<void> {
  const supabase = supabaseClient ?? (await createClient());
  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId);

  if (!drafts?.length) return;

  const { data: existingRows } = await supabase
    .from("roster_week_baselines")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  const coveredUserIds = new Set((existingRows ?? []).map((row) => row.user_id));
  const uncoveredDrafts = drafts.filter(
    (draft) => !coveredUserIds.has(draft.user_id)
  );
  if (uncoveredDrafts.length === 0) return;

  await Promise.all(
    uncoveredDrafts.map((draft) =>
      captureWeekBaselinesForUserCarryingForward(
        supabase,
        leagueId,
        draft.user_id,
        weekNumber,
        priorWeekNumber
      )
    )
  );
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

  if (!drafts?.length) return;

  // Load every roster up front so quotes are fetched once for the league.
  // This used to sit inside a per-manager loop fetching Finnhub quotes one
  // symbol at a time: a 32-team SDFL week came to 328 sequential fetches at
  // ~340ms each, ~112s measured for a single league-week, against a 300s cron
  // budget shared by every due week on the platform. The finalize cron timed
  // out before reaching most of them and died in the same place every run, so
  // weeks stopped finalizing and the backlog could not drain.
  const rosters = (
    await Promise.all(
      drafts.map(async (draft) => {
        let picks = (
          await loadUserDraftPicks(supabase, draft.user_id, leagueId)
        ).filter((pick) => pick.pick_type !== "skip");

        if (picks.length === 0) {
          const state = await loadDraftStateDetailed(draft.user_id, { leagueId });
          if (!state.ok) return null;
          picks = state.state.picks.filter((pick) => pick.pick_type !== "skip");
        }

        return {
          userId: draft.user_id,
          picks: picksEligibleForWeekBaselines(picks),
        };
      })
    )
  ).filter(
    (entry): entry is { userId: string; picks: DraftPick[] } => entry !== null
  );

  const allPicks = rosters.flatMap((roster) => roster.picks);
  if (allPicks.length === 0) return;

  const prices = await fetchPricesForPicks(allPicks);

  // A per-symbol Finnhub top-up used to run here, ten at a time, on top of the
  // prices fetched above. It existed because those prices came from a cache
  // that could be hours stale, so a close capture had to go and get fresh ones
  // itself — and on a large league most of those calls came back empty against
  // the 60-per-minute limit, leaving a capture that was partly fresh and partly
  // not, with no record of which was which.
  //
  // It is gone. fetchPricesForPicks now reads the price log, which the logger
  // refreshes every minute and which records the source and timestamp of
  // everything in it. There is nothing left to top up, and no provider call
  // belongs in a scoring path.

  // captureClosingValues fetches a real historical open for a pick with no
  // row yet, rather than reusing this same live quote for both ends — it
  // needs to know which trading day that open belongs to.
  const sessionDateIso = easternDateIso();

  for (const roster of rosters) {
    await captureClosingValues(
      supabase,
      {
        table: "roster_week_baselines",
        leagueId,
        userId: roster.userId,
        weekNumber,
      },
      roster.picks.map((pick) => ({
        pick,
        closePrice: prices.get(pick.symbol.toUpperCase()) ?? null,
      })),
      sessionDateIso
    );
  }
}

/**
 * Retries any pick still missing a real close for this week — either no
 * baseline row exists at all (the no-real-open case captureClosingValues now
 * refuses to fabricate) or a row exists with the close never filled in.
 *
 * captureWeekCloseSnapshots only runs once a day, from finalize-matchups. A
 * miss there used to mean waiting for tomorrow's run, and if the week
 * finalized before that happened, the pick simply stayed uncaptured forever —
 * honest, since nothing was invented, but still a permanent gap rather than a
 * recovered number. This is meant to run far more often (every 15 minutes,
 * matching the DFS backfill it mirrors) so a miss gets another real shot
 * within the hour instead of within a day, or never.
 *
 * Recovery goes straight to Twelve Data rather than retrying Finnhub — if
 * Finnhub already had it, there would be nothing to backfill. Equities only;
 * a crypto ticker on the second source can resolve to a different asset with
 * the same letters (confirmed on this exact platform: RAIN, MNT, U), so a
 * crypto pick missing its close stays missing here and needs its own live
 * source, not a guess dressed up as a fill.
 */
export async function fillMissingWeekCloses(
  leagueId: string,
  weekNumber: number,
  supabaseOverride?: SupabaseClient
): Promise<{ filled: number; stillMissing: number }> {
  if (!hasTwelveDataKey()) return { filled: 0, stillMissing: 0 };

  const supabase = supabaseOverride ?? (await createClient());
  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId);

  if (!drafts?.length) return { filled: 0, stillMissing: 0 };

  const rosters = (
    await Promise.all(
      drafts.map(async (draft) => {
        let picks = (
          await loadUserDraftPicks(supabase, draft.user_id, leagueId)
        ).filter((pick) => pick.pick_type !== "skip");

        if (picks.length === 0) {
          const state = await loadDraftStateDetailed(draft.user_id, { leagueId });
          if (!state.ok) return null;
          picks = state.state.picks.filter((pick) => pick.pick_type !== "skip");
        }

        return {
          userId: draft.user_id,
          picks: picksEligibleForWeekBaselines(picks),
        };
      })
    )
  ).filter(
    (entry): entry is { userId: string; picks: DraftPick[] } => entry !== null
  );

  const allPicks = rosters.flatMap((roster) => roster.picks);
  if (allPicks.length === 0) return { filled: 0, stillMissing: 0 };

  const { data: existing } = await supabase
    .from("roster_week_baselines")
    .select("pick_id, value_at_close")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);

  const closeByPick = new Map(
    (existing ?? []).map((row) => [row.pick_id as string, row.value_at_close])
  );

  const needsRecovery = allPicks.filter((pick) => {
    const close = closeByPick.get(pick.id);
    return !closeByPick.has(pick.id) || close == null;
  });
  if (needsRecovery.length === 0) return { filled: 0, stillMissing: 0 };

  const recoverableSymbols = [
    ...new Set(
      needsRecovery
        .filter((p) => p.pick_type === "stock" || p.pick_type === "bench")
        .map((p) => p.symbol.toUpperCase())
    ),
  ].filter(isTwelveDataSupported);

  const skippedCrypto = needsRecovery.filter(
    (p) => p.pick_type === "crypto" || isCryptoSymbol(p.symbol)
  ).length;
  if (skippedCrypto > 0) {
    console.warn(
      `[sdfl-backfill] league ${leagueId} wk${weekNumber}: ${skippedCrypto} crypto pick(s) still missing a close — not recoverable from this source`
    );
  }

  if (recoverableSymbols.length === 0) {
    return { filled: 0, stillMissing: needsRecovery.length };
  }

  // One minute's worth of budget per sweep; the next cron tick picks up the
  // rest, same pacing as the DFS backfill.
  const batch = recoverableSymbols.slice(0, TWELVE_DATA_CREDITS_PER_MINUTE);
  const sessionDateIso = easternDateIso();
  const bars = await fetchDailyOpenClose(batch, sessionDateIso);

  let filled = 0;
  const stillMissingSymbols = new Set(
    needsRecovery.map((p) => p.symbol.toUpperCase())
  );

  for (const roster of rosters) {
    const recoveredEntries = roster.picks
      .filter((pick) => batch.includes(pick.symbol.toUpperCase()))
      .filter((pick) => needsRecovery.some((n) => n.id === pick.id))
      .map((pick) => {
        const close = bars[pick.symbol.toUpperCase()]?.close;
        return { pick, closePrice: close ?? null };
      });

    if (recoveredEntries.length === 0) continue;

    await captureClosingValues(
      supabase,
      {
        table: "roster_week_baselines",
        leagueId,
        userId: roster.userId,
        weekNumber,
      },
      recoveredEntries,
      sessionDateIso
    );

    for (const entry of recoveredEntries) {
      if (entry.closePrice != null) {
        filled++;
        stillMissingSymbols.delete(entry.pick.symbol.toUpperCase());
        console.log(
          `[sdfl-backfill] league ${leagueId} wk${weekNumber} ${entry.pick.symbol}: close backfilled to ${entry.closePrice}`
        );
      }
    }
  }

  return { filled, stillMissing: needsRecovery.length - filled };
}

async function pruneOrphanCryptoBaselinesForUser(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number,
  draftPicks: DraftPick[]
): Promise<void> {
  const { data: baselines } = await supabase
    .from("roster_week_baselines")
    .select("pick_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("week_number", weekNumber);

  if (!baselines?.length) return;

  const pickIds = baselines.map((row) => row.pick_id);
  const { data: picks } = await supabase
    .from("draft_picks")
    .select("id, pick_type, budget_spent, shares, symbol, updated_at, pick_order")
    .in("id", pickIds);

  const loadedPicks = (picks ?? []) as DraftPick[];
  const orphanPickIds = loadedPicks
    .filter(
      (pick) => pick.pick_type === "crypto" && !isActiveCryptoPick(pick)
    )
    .map((pick) => pick.id);

  const duplicatePickIds = staleDuplicateCryptoPickIds(
    draftPicks.length > 0 ? draftPicks : loadedPicks
  );

  const prunePickIds = [...new Set([...orphanPickIds, ...duplicatePickIds])];
  if (prunePickIds.length === 0) return;

  await supabase
    .from("roster_week_baselines")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("week_number", weekNumber)
    .in("pick_id", prunePickIds);
}

export async function ensureWeekBaselines(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number,
  picks: DraftPick[]
): Promise<Map<string, number>> {
  const eligiblePicks = picksEligibleForWeekBaselines(
    picks.filter((p) => p.pick_type !== "skip")
  );

  let baselineMap = await loadWeekBaselineMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );

  const activePickIds = new Set(eligiblePicks.map((p) => p.id));
  const hasAllBaselines =
    eligiblePicks.length > 0 &&
    eligiblePicks.every((pick) => baselineMap.has(pick.id));

  if (!hasAllBaselines) {
    await captureWeekBaselinesForUser(supabase, leagueId, userId, weekNumber);
    baselineMap = await loadWeekBaselineMap(
      supabase,
      leagueId,
      userId,
      weekNumber
    );
  }

  await pruneOrphanCryptoBaselinesForUser(
    supabase,
    leagueId,
    userId,
    weekNumber,
    picks
  );

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
  await setPickWeekBaselineOpenClose(
    supabase,
    leagueId,
    userId,
    weekNumber,
    pickId,
    valueAtOpen
  );
}

export async function setPickWeekBaselineOpenClose(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number,
  pickId: string,
  valueAtOpen: number,
  valueAtClose?: number | null
): Promise<void> {
  const row: {
    league_id: string;
    user_id: string;
    week_number: number;
    pick_id: string;
    value_at_open: number;
    value_at_close?: number | null;
  } = {
    league_id: leagueId,
    user_id: userId,
    week_number: weekNumber,
    pick_id: pickId,
    value_at_open: valueAtOpen,
  };

  if (valueAtClose !== undefined) {
    row.value_at_close = valueAtClose;
  }

  await supabase.from("roster_week_baselines").upsert(row, {
    onConflict: "league_id,user_id,week_number,pick_id",
  });
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

/** Sports-sim IR move/return: set week baseline on the pick receiving roster value. */
export async function applyIrMoveWeekBaselines(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  receivingPickId: string,
  clearedPickId: string,
  transferBudget: number
): Promise<void> {
  const weekNumber = await getCurrentWeek(supabase, leagueId, userId);
  await setPickWeekBaseline(
    supabase,
    leagueId,
    userId,
    weekNumber,
    clearedPickId,
    0
  );
  await setPickWeekBaseline(
    supabase,
    leagueId,
    userId,
    weekNumber,
    receivingPickId,
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
  const baselineMap = await loadWeekBaselineExtendedMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );

  const sourceRow = baselineMap.get(sourcePickId);
  const sourceOpen = sourceRow?.valueAtOpen ?? soldBudget / sellFraction;
  const sourceClose = sourceRow?.valueAtClose ?? null;
  const scaledSource = scaleBaselineValuesForPartialSell(
    sourceOpen,
    sourceClose,
    sellFraction
  );

  await setPickWeekBaselineOpenClose(
    supabase,
    leagueId,
    userId,
    weekNumber,
    sourcePickId,
    scaledSource.valueAtOpen,
    scaledSource.valueAtClose ?? scaledSource.valueAtOpen
  );

  if (!targetPickId) return;

  if (isNewTarget) {
    const initial = initialBaselineValues(buyBudget);
    await setPickWeekBaselineOpenClose(
      supabase,
      leagueId,
      userId,
      weekNumber,
      targetPickId,
      initial.valueAtOpen,
      initial.valueAtClose
    );
    return;
  }

  const targetRow = baselineMap.get(targetPickId);
  const targetOpen = targetRow?.valueAtOpen ?? 0;
  const targetClose = targetRow?.valueAtClose ?? null;
  const adjustedTarget = addBudgetToBaselineValues(
    targetOpen,
    targetClose,
    soldBudget
  );

  await setPickWeekBaselineOpenClose(
    supabase,
    leagueId,
    userId,
    weekNumber,
    targetPickId,
    adjustedTarget.valueAtOpen,
    adjustedTarget.valueAtClose ?? adjustedTarget.valueAtOpen
  );
}

/** Persist merged crypto baseline history onto canonical pick rows after rebalance. */
export async function syncCryptoBaselinesAfterRebalance(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string
): Promise<void> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return;

  const picks = state.state.picks.filter((pick) => pick.pick_type !== "skip");
  const weekNumber = await getCurrentWeek(supabase, leagueId, userId);
  const byPick = await loadBaselinesThroughWeek(
    supabase,
    leagueId,
    userId,
    weekNumber,
    { picks }
  );

  for (const canon of canonicalActiveCryptoPicks(picks)) {
    const merged = byPick.get(canon.id);
    if (!merged) continue;

    for (const [week, row] of merged) {
      await setPickWeekBaselineOpenClose(
        supabase,
        leagueId,
        userId,
        week,
        canon.id,
        row.valueAtOpen,
        row.valueAtClose
      );
    }
  }
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

async function computeScoringSeasonPickMetricsForUser(
  userId: string,
  leagueId: string,
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: SupabaseClient;
  }
) {
  const supabase = options?.supabase ?? (await createClient());
  const weekNumber =
    options?.weekNumber ??
    (await getCurrentWeek(supabase, leagueId, userId));
  const weekInputs = await computeScoringWeekInputs(userId, leagueId, options);
  const state = await loadDraftStateDetailed(userId, { leagueId });
  const picks = state.ok
    ? state.state.picks.filter((pick) => pick.pick_type !== "skip")
    : [];
  const baselineByPick = await loadBaselinesThroughWeek(
    supabase,
    leagueId,
    userId,
    weekNumber,
    picks.length > 0 ? { picks } : undefined
  );

  return weekInputs.map((input) => {
    const season = computePickSeasonMetrics(
      baselineByPick.get(input.pickId),
      weekNumber,
      input.weekOpenValue,
      input.currentValue
    );
    return {
      currentValue: input.currentValue,
      ...season,
    };
  });
}

export async function computeScoringSeasonGainPercentForUser(
  userId: string,
  leagueId: string,
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: SupabaseClient;
  }
): Promise<number> {
  const seasonPicks = await computeScoringSeasonPickMetricsForUser(
    userId,
    leagueId,
    options
  );
  return computeTeamSeasonMetrics(seasonPicks).seasonGainPercent;
}

export async function computeScoringSeasonDollarGainForUser(
  userId: string,
  leagueId: string,
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: SupabaseClient;
  }
): Promise<number> {
  const seasonPicks = await computeScoringSeasonPickMetricsForUser(
    userId,
    leagueId,
    options
  );
  return computeTeamSeasonMetrics(seasonPicks).seasonDollarGain;
}

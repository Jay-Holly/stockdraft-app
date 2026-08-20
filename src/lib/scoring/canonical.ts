/**
 * Canonical baseline capture — single source of truth for all baseline writes
 * across season leagues, sports-sim leagues, and per-game multi-asset leagues.
 *
 * Rules enforced here so no caller can skip them:
 * - Only trustworthy values persist ($0 for a position holding shares means the
 *   quote failed, and storing it fabricates a -100% period).
 * - A period's open is filled once and never clobbered.
 * - A period's open inherits the prior period's close whenever one exists, so
 *   the week-to-week chain has no gaps.
 * - A close that moved more than MAX_ABS_PCT_CHANGE from its own open is a
 *   corrupted price, not a trade.
 *
 * These are BATCH functions on purpose. Per-pick round trips are what took the
 * matchups page down: one league page render fans out to every manager, and a
 * 32-team roster is ~500 picks, so a query per pick is ~1000 sequential round
 * trips inside a single request. Each function issues exactly one read and one
 * write per manager-period regardless of roster size.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftPick } from "@/lib/draft/types";
import { MAX_ABS_PCT_CHANGE } from "@/lib/market/quote-guards";
import {
  fetchDailyOpenClose,
  hasTwelveDataKey,
  isTwelveDataSupported,
  TWELVE_DATA_CREDITS_PER_MINUTE,
} from "@/lib/market/twelve-data";

/** Identifies one manager's slice of one scoring period. */
export type BaselineScope =
  | {
      table: "roster_week_baselines";
      leagueId: string;
      userId: string;
      weekNumber: number;
    }
  | {
      table: "roster_day_baselines";
      leagueId: string;
      userId: string;
      gameDate: string;
    };

function scopeColumns(scope: BaselineScope): Record<string, string | number> {
  return scope.table === "roster_week_baselines"
    ? {
        league_id: scope.leagueId,
        user_id: scope.userId,
        week_number: scope.weekNumber,
      }
    : {
        league_id: scope.leagueId,
        user_id: scope.userId,
        game_date: scope.gameDate,
      };
}

function conflictTarget(scope: BaselineScope): string {
  return scope.table === "roster_week_baselines"
    ? "league_id,user_id,week_number,pick_id"
    : "league_id,user_id,game_date,pick_id";
}

/** Canonical market value for a position: shares × price. */
export function computePickMarketValue(pick: DraftPick, price: number): number {
  if (price <= 0) return 0;
  return pick.shares * price;
}

/**
 * A $0 value for a position that actually holds shares means the quote fetch
 * failed — persisting it poisons weekly and season math with a fake -100%.
 * Genuinely empty slots (__OPEN__, 0-share bench) really are $0.
 */
export function isTrustworthyValue(pick: DraftPick, value: number): boolean {
  if (value > 0) return true;
  return pick.shares <= 0 || pick.symbol.toUpperCase() === "__OPEN__";
}

/**
 * A close more than MAX_ABS_PCT_CHANGE from its own open is a corrupted price.
 * Same guard SDDFS/SDWFS apply per pick, extended to season and per-game
 * baselines — one bad row poisons every season-to-date total that sums it.
 */
export function isPlausibleMove(openValue: number, closeValue: number): boolean {
  if (openValue <= 0) return true;
  const pct = Math.abs(((closeValue - openValue) / openValue) * 100);
  return pct <= MAX_ABS_PCT_CHANGE;
}

export type OpeningEntry = {
  pick: DraftPick;
  /** The prior period's close, carried forward verbatim when present. */
  priorClose: number | null;
  /** Price PER SHARE. Omit (null) when the quote failed — nothing is written. */
  livePrice: number | null;
};

/**
 * Fill in this period's opening value for every pick that lacks one.
 * One read, one write, regardless of how many picks are passed.
 */
export async function captureOpeningValues(
  supabase: SupabaseClient,
  scope: BaselineScope,
  entries: OpeningEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  const scopeCols = scopeColumns(scope);

  const { data: existing } = await supabase
    .from(scope.table)
    .select("pick_id, value_at_open")
    .match(scopeCols);

  const alreadyOpen = new Set(
    (existing ?? [])
      .filter((row) => row.value_at_open != null)
      .map((row) => row.pick_id as string)
  );

  const rows: Record<string, string | number>[] = [];
  for (const { pick, priorClose, livePrice } of entries) {
    if (alreadyOpen.has(pick.id)) continue;

    // A prior close is already a position value and carries across untouched.
    // A live price is per share and must be converted, or an $80,000 position
    // records an opening value of ~$348 and the period scores as a wipeout.
    const openValue =
      priorClose !== null
        ? priorClose
        : livePrice !== null
          ? computePickMarketValue(pick, livePrice)
          : null;

    if (openValue === null) continue;
    if (!isTrustworthyValue(pick, openValue)) continue;

    rows.push({ ...scopeCols, pick_id: pick.id, value_at_open: openValue });
  }

  if (rows.length === 0) return;

  // ignoreDuplicates keeps a concurrent writer's real open from being replaced
  // by whatever price happens to be live when this path re-runs.
  await supabase.from(scope.table).upsert(rows as never, {
    onConflict: conflictTarget(scope),
    ignoreDuplicates: true,
  });
}

export type ClosingEntry = {
  pick: DraftPick;
  /** Price PER SHARE. Omit (null) when the quote failed — nothing is written. */
  closePrice: number | null;
};

/**
 * Snapshot this period's closing value. One read, one write.
 *
 * A pick with no opening row yet used to get one written at the same value as
 * the close — reusing the single live quote this function just fetched for
 * BOTH ends of the period. That is not a real open; it is one instant in time
 * pretending to be two, and it erases the period's entire real move. Confirmed
 * in production: 2,303 of 8,313 funded weekly positions across the platform
 * carry this exact signature, open equal to close to the cent, because the
 * real week-start capture (ensureWeekBaselines) never reached that pick before
 * this function did.
 *
 * The fix is not to fabricate a better guess — it's to get the real number or
 * leave the pick uncaptured. `sessionDateIso` — the actual trading day this
 * close represents — lets a first-time pick fetch its real historical open
 * from an independent source (Twelve Data) instead of copying the close. When
 * that source can't answer (crypto, or data not there yet), the pick is left
 * out entirely rather than seeded with a fabricated flat line; a later sweep
 * picks it up once a real number exists.
 */
export async function captureClosingValues(
  supabase: SupabaseClient,
  scope: BaselineScope,
  entries: ClosingEntry[],
  sessionDateIso: string
): Promise<void> {
  if (entries.length === 0) return;

  const scopeCols = scopeColumns(scope);

  const { data: existing } = await supabase
    .from(scope.table)
    .select("pick_id, value_at_open, value_at_close")
    .match(scopeCols);

  const existingByPick = new Map(
    (existing ?? []).map((row) => [row.pick_id as string, row])
  );

  // Picks with no prior row need a real historical open, not the close
  // reused. Batch one Twelve Data call per sweep, budgeted the same as the
  // DFS backfill it mirrors — this function already runs on a recurring
  // cron, so anything past budget is simply picked up on the next tick.
  const needsRealOpen = entries.filter(
    ({ pick, closePrice }) =>
      closePrice !== null &&
      !existingByPick.has(pick.id) &&
      isTwelveDataSupported(pick.symbol)
  );
  const openSymbols = [
    ...new Set(needsRealOpen.map((e) => e.pick.symbol.toUpperCase())),
  ].slice(0, TWELVE_DATA_CREDITS_PER_MINUTE);
  const historicalOpens =
    openSymbols.length > 0 && hasTwelveDataKey()
      ? await fetchDailyOpenClose(openSymbols, sessionDateIso)
      : {};

  const rows: Record<string, string | number>[] = [];
  const deferred: string[] = [];

  for (const { pick, closePrice } of entries) {
    if (closePrice === null) continue;

    const closeValue = computePickMarketValue(pick, closePrice);
    if (!isTrustworthyValue(pick, closeValue)) continue;

    const prior = existingByPick.get(pick.id);
    const existingClose =
      prior?.value_at_close != null ? Number(prior.value_at_close) : null;

    let openValue: number;
    if (prior?.value_at_open != null) {
      openValue = Number(prior.value_at_open);
    } else {
      const symbol = pick.symbol.toUpperCase();
      const realOpen = historicalOpens[symbol]?.open;
      if (realOpen == null) {
        // No real open available this sweep. Do not seed the row with the
        // close standing in for the open — that is the exact fabrication
        // this function exists to stop. Leave it uncaptured; the next sweep
        // (with historical data that may be available by then, or a prior
        // row from ensureWeekBaselines catching up) tries again.
        deferred.push(`${pick.symbol} (pick ${pick.id})`);
        continue;
      }
      openValue = computePickMarketValue(pick, realOpen);
      if (!isTrustworthyValue(pick, openValue)) continue;
    }

    // Never flatten a real close back to open == close.
    if (
      existingClose !== null &&
      existingClose !== openValue &&
      closeValue === openValue
    ) {
      continue;
    }

    if (!isPlausibleMove(openValue, closeValue)) {
      console.error(
        `[scoring] implausible close for ${pick.symbol} (pick ${pick.id}): open=${openValue} close=${closeValue}; skipping`
      );
      continue;
    }

    rows.push({
      ...scopeCols,
      pick_id: pick.id,
      value_at_open: openValue,
      value_at_close: closeValue,
    });
  }

  if (deferred.length > 0) {
    console.warn(
      `[scoring] no real open yet for ${deferred.length} first-seen pick(s), left uncaptured rather than faked: ${deferred.join(", ")}`
    );
  }

  if (rows.length === 0) return;

  await supabase.from(scope.table).upsert(rows as never, {
    onConflict: conflictTarget(scope),
  });
}

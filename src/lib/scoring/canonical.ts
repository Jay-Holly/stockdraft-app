/**
 * Canonical baseline capture functions — single source of truth for all
 * baseline writes across season leagues, sports-sim leagues, day-trader,
 * and DFS/WFS contests. All baseline paths converge here.
 *
 * Design decisions:
 * - Baselines only write if trustworthy (>0 value for stocks with shares)
 * - Opening values never clobber existing values (new baselines fill gaps only)
 * - Closing values can overwrite but guard against degeneracy (open==close fallback)
 * - When prior period's close exists, new period's open inherits it (no gaps)
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftPick } from "@/lib/draft/types";
import { MAX_ABS_PCT_CHANGE } from "@/lib/market/quote-guards";

/**
 * Canonical market value for a pick: shares × price.
 * Used wherever a pick's current value is needed.
 */
export function computePickMarketValue(pick: DraftPick, price: number): number {
  if (price <= 0) return 0;
  return pick.shares * price;
}

/**
 * Guard: is this value trustworthy to persist as a baseline?
 * A $0 market value for a pick that actually holds shares means quote fetch failed —
 * persisting it poisons weekly/season math with fake -100% weeks.
 * Empty slots (__OPEN__, 0-share bench) genuinely are $0 and are safe to record.
 */
export function isTrustworthyValue(pick: DraftPick, value: number): boolean {
  if (value > 0) return true;
  // Allow $0 only for truly empty slots
  return pick.shares <= 0 || pick.symbol.toUpperCase() === "__OPEN__";
}

/**
 * A close more than MAX_ABS_PCT_CHANGE away from its own open is a corrupted
 * price, not a trade — the same guard SDDFS/SDWFS apply per pick, extended to
 * season and per-game baselines. Persisting one poisons every season-to-date
 * total that sums this week's delta.
 */
export function isPlausibleMove(openValue: number, closeValue: number): boolean {
  if (openValue <= 0) return true;
  const pct = Math.abs(((closeValue - openValue) / openValue) * 100);
  return pct <= MAX_ABS_PCT_CHANGE;
}

/**
 * Capture a pick's opening value for a period (week or day).
 * - If prior period's close exists, inherit it (ensures chain continuity)
 * - Else fetch live price
 * - Never overwrite an existing opening value (fill only)
 * - Only write if trustworthy
 */
export async function captureOpeningValueForPick(
  supabase: SupabaseClient,
  table: "roster_week_baselines" | "roster_day_baselines",
  periodKey: { league_id: string; user_id: string; pick_id: string } & (
    | { week_number: number }
    | { game_date: string }
  ),
  pick: DraftPick,
  priorPeriodClose: number | null,
  livePrice: number
): Promise<void> {
  // Determine this period's opening: prior close if available, else live price
  const openValue =
    priorPeriodClose !== null ? priorPeriodClose : livePrice;

  if (!isTrustworthyValue(pick, openValue)) return;

  // Check if opening already exists for this pick in this period
  const whereClause: Record<string, string | number> = {
    league_id: periodKey.league_id,
    user_id: periodKey.user_id,
    pick_id: periodKey.pick_id,
  };
  if ("week_number" in periodKey) {
    whereClause.week_number = periodKey.week_number;
  } else {
    whereClause.game_date = periodKey.game_date;
  }

  const { data: existing } = await supabase
    .from(table)
    .select("value_at_open")
    .match(whereClause)
    .maybeSingle();

  // Only fill if missing; never overwrite
  if (existing?.value_at_open != null) return;

  // Insert or update, but only fill the opening value
  const row: Record<string, string | number> = {
    ...periodKey,
    value_at_open: openValue,
  };

  const { onConflict, ignoreDuplicates } =
    table === "roster_week_baselines"
      ? {
          onConflict: "league_id,user_id,week_number,pick_id",
          ignoreDuplicates: true,
        }
      : {
          onConflict: "league_id,user_id,game_date,pick_id",
          ignoreDuplicates: true,
        };

  await supabase.from(table).upsert(row as never, {
    onConflict,
    ignoreDuplicates,
  });
}

/**
 * Capture a pick's closing value for a period.
 * - Can overwrite an existing closing value
 * - Guards against fallback scenario (live price fetch failed, open==close)
 * - Only write if trustworthy
 */
export async function captureClosingValueForPick(
  supabase: SupabaseClient,
  table: "roster_week_baselines" | "roster_day_baselines",
  periodKey: { league_id: string; user_id: string; pick_id: string } & (
    | { week_number: number }
    | { game_date: string }
  ),
  pick: DraftPick,
  closePrice: number
): Promise<void> {
  const closeValue = computePickMarketValue(pick, closePrice);

  if (!isTrustworthyValue(pick, closeValue)) return;

  const whereClause: Record<string, string | number> = {
    league_id: periodKey.league_id,
    user_id: periodKey.user_id,
    pick_id: periodKey.pick_id,
  };
  if ("week_number" in periodKey) {
    whereClause.week_number = periodKey.week_number;
  } else {
    whereClause.game_date = periodKey.game_date;
  }

  // Check if there's already data for this period
  const { data: existing } = await supabase
    .from(table)
    .select("value_at_open, value_at_close")
    .match(whereClause)
    .maybeSingle();

  if (!existing) return; // No opening baseline exists; nothing to close

  const existingClose =
    existing.value_at_close != null ? Number(existing.value_at_close) : null;
  const openValue = Number(existing.value_at_open);

  // Guard: if there's already a real close and we're about to replace it
  // with open==close (fallback), keep the original
  if (
    existingClose != null &&
    existingClose !== openValue &&
    closeValue === openValue
  ) {
    return;
  }

  if (!isPlausibleMove(openValue, closeValue)) {
    console.error(
      `[scoring] implausible close for pick ${pick.symbol} (${periodKey.pick_id}): open=${openValue} close=${closeValue}; skipping write`
    );
    return;
  }

  // Update only the closing value
  const row: Record<string, string | number> = {
    ...periodKey,
    value_at_close: closeValue,
  };

  const { onConflict } =
    table === "roster_week_baselines"
      ? { onConflict: "league_id,user_id,week_number,pick_id" }
      : { onConflict: "league_id,user_id,game_date,pick_id" };

  await supabase.from(table).upsert(row as never, { onConflict });
}


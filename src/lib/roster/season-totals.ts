import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftPick } from "@/lib/draft/types";
import { canonicalActiveCryptoPicks } from "@/lib/roster/crypto-picks";
import type { WeekBaselineRow } from "@/lib/season/weekend-scoring";
import {
  computeWeekDollarGain,
  computeWeekGainPercent,
  computeScoringWeekGainPercent,
} from "@/lib/roster/scoring-math";

type BaselineWeekMap = Map<number, WeekBaselineRow>;

function mergeCryptoBaselineWeekMaps(
  pickIds: string[],
  byPick: Map<string, BaselineWeekMap>,
  throughWeek: number
): BaselineWeekMap {
  const merged = new Map<number, WeekBaselineRow>();

  for (let week = 1; week <= throughWeek; week++) {
    for (const pickId of pickIds) {
      const row = byPick.get(pickId)?.get(week);
      if (row) {
        merged.set(week, row);
        break;
      }
    }
  }

  return merged;
}

function applyCryptoBaselineMerges(
  byPick: Map<string, BaselineWeekMap>,
  picks: DraftPick[],
  throughWeek: number
): void {
  const canonical = canonicalActiveCryptoPicks(picks);
  const symbolToPickIds = new Map<string, string[]>();
  const pickOrder = new Map(picks.map((pick) => [pick.id, pick.pick_order]));

  for (const pick of picks) {
    if (pick.pick_type !== "crypto") continue;
    const symbol = pick.symbol.toUpperCase();
    const ids = symbolToPickIds.get(symbol) ?? [];
    ids.push(pick.id);
    symbolToPickIds.set(symbol, ids);
  }

  for (const canon of canonical) {
    const symbol = canon.symbol.toUpperCase();
    const siblingIds = [...(symbolToPickIds.get(symbol) ?? [canon.id])].sort(
      (a, b) => (pickOrder.get(a) ?? 0) - (pickOrder.get(b) ?? 0)
    );
    const orderedIds = [
      canon.id,
      ...siblingIds.filter((id) => id !== canon.id),
    ];
    const merged = mergeCryptoBaselineWeekMaps(orderedIds, byPick, throughWeek);
    if (merged.size > 0) {
      byPick.set(canon.id, merged);
    }
  }
}

export type PickSeasonMetrics = {
  seasonOpenValue: number;
  seasonDollarGain: number;
  seasonGainPercent: number;
};

export type ScoringValueInput = {
  currentValue: number;
  weekOpenValue: number;
};

export async function loadBaselinesThroughWeek(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  throughWeek: number,
  options?: { picks?: DraftPick[] }
): Promise<Map<string, BaselineWeekMap>> {
  const { data, error } = await supabase
    .from("roster_week_baselines")
    .select(
      "pick_id, week_number, value_at_open, value_at_close, stock_value_at_friday_close"
    )
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .gte("week_number", 1)
    .lte("week_number", throughWeek)
    .order("week_number", { ascending: true });

  if (error || !data) return new Map();

  const byPick = new Map<string, BaselineWeekMap>();

  for (const row of data) {
    const weekMap = byPick.get(row.pick_id) ?? new Map<number, WeekBaselineRow>();
    weekMap.set(row.week_number, {
      valueAtOpen: Number(row.value_at_open),
      valueAtClose:
        row.value_at_close != null ? Number(row.value_at_close) : null,
      stockValueAtFridayClose:
        row.stock_value_at_friday_close != null
          ? Number(row.stock_value_at_friday_close)
          : null,
    });
    byPick.set(row.pick_id, weekMap);
  }

  if (options?.picks?.length) {
    applyCryptoBaselineMerges(byPick, options.picks, throughWeek);
  }

  return byPick;
}

function resolveSeasonOpenValue(
  baselineByWeek: BaselineWeekMap | undefined,
  fallbackOpen: number
): number {
  const weekOne = baselineByWeek?.get(1);
  if (weekOne && weekOne.valueAtOpen > 0) return weekOne.valueAtOpen;

  if (baselineByWeek && baselineByWeek.size > 0) {
    const firstWeek = Math.min(...baselineByWeek.keys());
    const firstOpen = baselineByWeek.get(firstWeek)?.valueAtOpen ?? 0;
    if (firstOpen > 0) return firstOpen;
  }

  return fallbackOpen;
}

/**
 * Season totals = cumulative scored weeks since the current season's week-1
 * baselines. Week 1 season metrics always match week 1 weekly metrics.
 */
export function computePickSeasonMetrics(
  baselineByWeek: BaselineWeekMap | undefined,
  throughWeek: number,
  weekOpenValue: number,
  currentValue: number
): PickSeasonMetrics {
  if (throughWeek <= 1) {
    const seasonDollarGain = computeWeekDollarGain(currentValue, weekOpenValue);
    return {
      seasonOpenValue: weekOpenValue,
      seasonDollarGain,
      seasonGainPercent: computeWeekGainPercent(currentValue, weekOpenValue),
    };
  }

  const seasonOpenValue = resolveSeasonOpenValue(baselineByWeek, weekOpenValue);
  let seasonDollarGain = 0;

  if (baselineByWeek) {
    for (let week = 1; week < throughWeek; week++) {
      const row = baselineByWeek.get(week);
      if (!row || row.valueAtClose == null) continue;
      seasonDollarGain += computeWeekDollarGain(row.valueAtClose, row.valueAtOpen);
    }
  }

  seasonDollarGain += computeWeekDollarGain(currentValue, weekOpenValue);

  const seasonEndValue = seasonOpenValue + seasonDollarGain;

  return {
    seasonOpenValue,
    seasonDollarGain,
    seasonGainPercent: computeWeekGainPercent(seasonEndValue, seasonOpenValue),
  };
}

export function computeTeamSeasonMetrics(
  scoringPicks: Array<{
    currentValue: number;
    seasonOpenValue: number;
    seasonDollarGain: number;
  }>
): { seasonDollarGain: number; seasonGainPercent: number } {
  const seasonDollarGain = scoringPicks.reduce(
    (sum, pick) => sum + pick.seasonDollarGain,
    0
  );

  const seasonInputs: ScoringValueInput[] = scoringPicks.map((pick) => ({
    currentValue: pick.currentValue,
    weekOpenValue: pick.seasonOpenValue,
  }));

  return {
    seasonDollarGain,
    seasonGainPercent: computeScoringWeekGainPercent(seasonInputs),
  };
}

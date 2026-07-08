import type { DraftPick } from "@/lib/draft/types";
import { createClient } from "@/lib/supabase/server";
import type { RosterPickView } from "@/lib/roster/types";
import {
  computePickSeasonMetrics,
  loadBaselinesThroughWeek,
} from "@/lib/roster/season-totals";
import {
  computeWeekDollarGain,
  computeWeekGainPercent,
  loadWeekBaselineMap,
} from "@/lib/roster/weekly";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type WeekBaselineRow = {
  open: number;
  close: number | null;
};

async function loadWeekBaselineDetailMap(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number
): Promise<Map<string, WeekBaselineRow>> {
  const { data, error } = await supabase
    .from("roster_week_baselines")
    .select("pick_id, value_at_open, value_at_close")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("week_number", weekNumber);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [
      row.pick_id,
      {
        open: Number(row.value_at_open),
        close:
          row.value_at_close != null ? Number(row.value_at_close) : null,
      },
    ])
  );
}

function resolveWeekCloseValue(
  pickId: string,
  weekDetail: WeekBaselineRow | undefined,
  nextWeekOpen: number | undefined
): number {
  if (weekDetail?.close != null) return weekDetail.close;
  if (nextWeekOpen != null) return nextWeekOpen;
  return weekDetail?.open ?? 0;
}

import { isActiveCryptoPick, isScoringRosterPick } from "@/lib/roster/crypto-picks";

export async function buildHistoricalRosterPicks(
  leagueId: string,
  userId: string,
  weekNumber: number,
  picks: DraftPick[]
): Promise<RosterPickView[]> {
  const supabase = await createClient();
  const [weekBaselines, nextWeekBaselines, baselineByPick] = await Promise.all([
    loadWeekBaselineDetailMap(supabase, leagueId, userId, weekNumber),
    loadWeekBaselineMap(supabase, leagueId, userId, weekNumber + 1),
    loadBaselinesThroughWeek(supabase, leagueId, userId, weekNumber, { picks }),
  ]);

  const relevantPickIds = new Set<string>([
    ...weekBaselines.keys(),
    ...nextWeekBaselines.keys(),
  ]);

  const activePicks = picks.filter(
    (pick) => pick.pick_type !== "skip" && relevantPickIds.has(pick.id)
  );

  return activePicks.map((pick) => {
    const symbol = pick.symbol.toUpperCase();
    const weekDetail = weekBaselines.get(pick.id);
    const weekOpenValue = weekDetail?.open ?? nextWeekBaselines.get(pick.id) ?? 0;
    const weekCloseValue = resolveWeekCloseValue(
      pick.id,
      weekDetail,
      nextWeekBaselines.get(pick.id)
    );

    const scores = isScoringRosterPick(pick);
    const shares = pick.shares > 0 ? pick.shares : 0;
    const currentPrice =
      shares > 0 ? weekCloseValue / shares : pick.price_at_pick;
    const currentValue = weekCloseValue;
    const weekDollarGain = computeWeekDollarGain(weekCloseValue, weekOpenValue);
    const weekGainPercent = computeWeekGainPercent(weekCloseValue, weekOpenValue);
    const season = computePickSeasonMetrics(
      baselineByPick.get(pick.id),
      weekNumber,
      weekOpenValue,
      weekCloseValue
    );
    const gainPercent = scores ? season.seasonGainPercent : 0;

    if (symbol === "__OPEN__") {
      return {
        ...pick,
        acquired_via: (pick as DraftPick & { acquired_via?: string }).acquired_via,
        currentPrice: 0,
        changePercent: 0,
        currentValue: 0,
        gainPercent: 0,
        weekOpenValue: 0,
        weekDollarGain: 0,
        weekGainPercent: 0,
        seasonDollarGain: 0,
        seasonOpenValue: 0,
        scores: false,
      };
    }

    return {
      ...pick,
      acquired_via: (pick as DraftPick & { acquired_via?: string }).acquired_via,
      currentPrice,
      changePercent: weekOpenValue > 0 ? weekGainPercent : 0,
      currentValue,
      gainPercent,
      weekOpenValue,
      weekDollarGain,
      weekGainPercent,
      seasonOpenValue: season.seasonOpenValue,
      seasonDollarGain: season.seasonDollarGain,
      scores,
    };
  });
}

export function partitionHistoricalRosterPicks(picks: RosterPickView[]): {
  starters: RosterPickView[];
  bench: RosterPickView[];
  ir: RosterPickView[];
  crypto: RosterPickView[];
} {
  return {
    starters: picks.filter((pick) => pick.pick_type === "stock"),
    bench: picks.filter((pick) => pick.pick_type === "bench"),
    ir: picks.filter((pick) => pick.pick_type === "ir"),
    crypto: picks.filter(
      (pick) => pick.pick_type === "crypto" && isActiveCryptoPick(pick)
    ),
  };
}

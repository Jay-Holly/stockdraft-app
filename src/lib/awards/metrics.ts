import type { SupabaseClient } from "@supabase/supabase-js";
import type { AwardPickMetric } from "@/lib/awards/types";

function weekGainPct(open: number, close: number): number {
  if (open <= 0) return 0;
  return ((close - open) / open) * 100;
}

export async function loadAwardPickMetrics(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number
): Promise<AwardPickMetric[]> {
  const { data: baselines, error } = await supabase
    .from("roster_week_baselines")
    .select(
      "user_id, pick_id, value_at_open, value_at_close, stock_value_at_friday_close"
    )
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);

  if (error || !baselines?.length) return [];

  const pickIds = baselines.map((row) => row.pick_id);
  const { data: picks } = await supabase
    .from("draft_picks")
    .select("id, pick_type, symbol")
    .in("id", pickIds);

  const pickById = new Map(
    (picks ?? []).map((pick) => [pick.id, pick] as const)
  );

  const metrics: AwardPickMetric[] = [];

  for (const row of baselines) {
    if (row.value_at_close == null) continue;

    const pick = pickById.get(row.pick_id);
    if (!pick) continue;

    const pickType = pick.pick_type;
    if (
      pickType !== "stock" &&
      pickType !== "bench" &&
      pickType !== "crypto"
    ) {
      continue;
    }

    const valueAtOpen = Number(row.value_at_open);
    const valueAtClose = Number(row.value_at_close);

    metrics.push({
      userId: row.user_id,
      pickId: row.pick_id,
      pickType,
      symbol: pick.symbol.toUpperCase(),
      valueAtOpen,
      valueAtClose,
      stockValueAtFridayClose:
        row.stock_value_at_friday_close != null
          ? Number(row.stock_value_at_friday_close)
          : null,
      weekDollarGain: valueAtClose - valueAtOpen,
      weekGainPct: weekGainPct(valueAtOpen, valueAtClose),
    });
  }

  return metrics;
}

export function groupMetricsByUser(
  metrics: AwardPickMetric[]
): Map<string, AwardPickMetric[]> {
  const map = new Map<string, AwardPickMetric[]>();
  for (const metric of metrics) {
    const list = map.get(metric.userId) ?? [];
    list.push(metric);
    map.set(metric.userId, list);
  }
  return map;
}

export function filterPickType(
  metrics: AwardPickMetric[],
  types: Array<AwardPickMetric["pickType"]>
): AwardPickMetric[] {
  return metrics.filter((metric) => types.includes(metric.pickType));
}

export function sumDollarGain(metrics: AwardPickMetric[]): number {
  return metrics.reduce((sum, metric) => sum + metric.weekDollarGain, 0);
}

export function teamScoringWeekGainPercent(
  metrics: AwardPickMetric[]
): number {
  const scoring = filterPickType(metrics, ["stock", "crypto"]);
  let openTotal = 0;
  let closeTotal = 0;
  for (const pick of scoring) {
    openTotal += pick.valueAtOpen;
    closeTotal += pick.valueAtClose;
  }
  if (openTotal <= 0) return 0;
  return ((closeTotal - openTotal) / openTotal) * 100;
}

export function lowestCapturedValue(metric: AwardPickMetric): number {
  const candidates = [metric.valueAtOpen, metric.valueAtClose];
  if (metric.stockValueAtFridayClose != null) {
    candidates.push(metric.stockValueAtFridayClose);
  }
  return Math.min(...candidates);
}

export function recoverySwing(metric: AwardPickMetric): number {
  return metric.valueAtClose - lowestCapturedValue(metric);
}

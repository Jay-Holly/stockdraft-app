/**
 * Season totals logic checks.
 * Run: npx --yes tsx scripts/test-season-totals.ts
 */
import { computePickSeasonMetrics, computeTeamSeasonMetrics } from "../src/lib/roster/season-totals";
import type { WeekBaselineRow } from "../src/lib/season/weekend-scoring";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok:", message);
}

function closeRow(open: number, close: number): WeekBaselineRow {
  return {
    valueAtOpen: open,
    valueAtClose: close,
    stockValueAtFridayClose: null,
  };
}

// Week 1 with no prior baselines: season === weekly
{
  const season = computePickSeasonMetrics(undefined, 1, 10_000, 10_500);
  assert(season.seasonDollarGain === 500, "week 1 season $ equals weekly $");
  assert(
    Math.abs(season.seasonGainPercent - 5) < 0.0001,
    "week 1 season % equals weekly %"
  );
  assert(season.seasonOpenValue === 10_000, "week 1 season open equals week open");
}

// Week 2: sum of finalized week 1 + current week 2
{
  const baselines = new Map<number, WeekBaselineRow>([
    [1, closeRow(10_000, 10_500)],
    [2, { valueAtOpen: 10_500, valueAtClose: null, stockValueAtFridayClose: null }],
  ]);
  const season = computePickSeasonMetrics(baselines, 2, 10_500, 10_800);
  assert(season.seasonDollarGain === 800, "week 2 season $ sums week 1 + week 2");
  assert(
    Math.abs(season.seasonGainPercent - 8) < 0.0001,
    "week 2 season % from week-1 open through week-2 close"
  );
  assert(season.seasonOpenValue === 10_000, "season open anchored to week 1 baseline");
}

// Team rollup uses week-1 opens, not draft cost
{
  const team = computeTeamSeasonMetrics([
    {
      currentValue: 10_800,
      seasonOpenValue: 10_000,
      seasonDollarGain: 800,
    },
    {
      currentValue: 5_250,
      seasonOpenValue: 5_000,
      seasonDollarGain: 250,
    },
  ]);
  assert(team.seasonDollarGain === 1_050, "team season $ sums pick season $");
  assert(
    Math.abs(team.seasonGainPercent - 7) < 0.0001,
    "team season % weighted by week-1 opens"
  );
}

console.log("\nSeason totals checks passed.");

/**
 * SDPL 11-week cycling schedule unit tests.
 * Run: npx --yes tsx scripts/test-sdpl-cycling-schedule.ts
 */
import {
  SDPL_REGULAR_SEASON_WEEKS,
  generateCyclingRegularSeasonSchedule,
  generateRegularSeasonSchedule,
  getSdplPlayoffWeeks,
  missingSdplRegularSeasonWeeks,
  sdplScheduleNeedsReseed,
} from "../src/lib/matchup/schedule";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok:", message);
}

function teamIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000${String(i + 1).padStart(3, "0")}`
  );
}

const fourTeam = teamIds(4);
const schedule4 = generateCyclingRegularSeasonSchedule(fourTeam, 11);
assert(schedule4.length === 22, "4-team × 11 weeks = 22 matchups");
assert(
  new Set(schedule4.map((g) => g.weekNumber)).size === 11,
  "4-team schedule spans weeks 1–11"
);
assert(
  schedule4.filter((g) => g.weekNumber === 1).length === 2,
  "4-team week 1 has 2 games"
);
assert(
  schedule4.filter((g) => g.weekNumber === 4).length === 2,
  "4-team week 4 cycles slate 1 again"
);

const legacy4 = generateRegularSeasonSchedule(fourTeam);
assert(legacy4.length === 6, "legacy 4-team still 3 weeks × 2 games");

const twelveTeam = teamIds(12);
const schedule12 = generateCyclingRegularSeasonSchedule(twelveTeam, 11);
assert(schedule12.length === 66, "12-team × 11 weeks = 66 matchups (11 unique slates)");
assert(
  schedule12.filter((g) => g.weekNumber === 11).length === 6,
  "12-team week 11 has 6 games"
);

const playoffs = getSdplPlayoffWeeks(11);
assert(playoffs.semifinalWeek === 12, "semifinal week = regular + 1");
assert(playoffs.finalsWeek === 13, "finals week = regular + 2");
assert(
  getSdplPlayoffWeeks(SDPL_REGULAR_SEASON_WEEKS).semifinalWeek === 12,
  "default SDPL semis at week 12"
);

assert(sdplScheduleNeedsReseed([1, 2, 3], 11) === false, "3 weeks is extend not reseed");
assert(sdplScheduleNeedsReseed([1, 2, 15], 11) === true, "week 15 is stale reseed");
assert(
  missingSdplRegularSeasonWeeks([1, 2, 3], 11).join(",") === "4,5,6,7,8,9,10,11",
  "missing weeks 4–11 for partial legacy schedule"
);

console.log("\nAll SDPL cycling schedule tests passed.");

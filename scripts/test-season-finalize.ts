/**
 * SDPL finalize schedule unit tests.
 * Run: npx --yes tsx scripts/test-season-finalize.ts
 */
import {
  computeWeekFinalizeAt,
  isPastFinalizeAt,
  usesSameDayCloseCapture,
  weekUsesWeekendExtension,
} from "../src/lib/season/finalize-times";
import { resolveSeasonSettings } from "../src/lib/season/calendar";
import { SDAI_BETA_WEEK_CALENDAR } from "../src/lib/season/beta-schedule";
import { zonedDateTimeFromIso } from "../src/lib/season/eastern-time";
import {
  baselinesHaveFridayClose,
  resolveHybridScoringValue,
} from "../src/lib/season/weekend-scoring";
import type { DraftPick } from "../src/lib/draft/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok:", message);
}

const sdpl4 = { formatType: "standard", playerCount: 4 };
const standard = resolveSeasonSettings(sdpl4);
const beta = resolveSeasonSettings(sdpl4, {
  season_format: "beta_daily",
  regular_season_weeks: 11,
  week_calendar: [
    { week: 5, date: "2026-07-03" },
    { week: 6, date: "2026-07-06" },
  ],
});

assert(weekUsesWeekendExtension(standard, 1), "standard week uses weekend extension");
assert(
  !weekUsesWeekendExtension(beta, 6),
  "beta Monday week 6 has no weekend extension"
);
assert(
  weekUsesWeekendExtension(beta, 5),
  "beta Friday week 5 uses weekend extension"
);

const betaTue = computeWeekFinalizeAt(beta, 2, zonedDateTimeFromIso("2026-06-30", 10, 0));
assert(
  betaTue.getTime() === zonedDateTimeFromIso("2026-06-30", 16, 0).getTime(),
  "beta Tue week finalizes 4 PM same day"
);

const betaFri = computeWeekFinalizeAt(beta, 5, zonedDateTimeFromIso("2026-07-03", 10, 0));
assert(
  betaFri.getTime() === zonedDateTimeFromIso("2026-07-06", 6, 0).getTime(),
  "beta Fri week 5 finalizes Mon Jul 6 6 AM"
);

const sdaiBeta = resolveSeasonSettings(sdpl4, {
  season_format: "beta_daily",
  regular_season_weeks: 11,
  week_calendar: SDAI_BETA_WEEK_CALENDAR,
});
const sdaiWeek1 = computeWeekFinalizeAt(
  sdaiBeta,
  1,
  zonedDateTimeFromIso("2026-06-29", 10, 0)
);
assert(
  sdaiWeek1.getTime() === zonedDateTimeFromIso("2026-06-29", 16, 0).getTime(),
  "SDAI-00039 beta week 1 (Mon Jun 29) finalizes same day 4 PM ET"
);

assert(
  !usesSameDayCloseCapture(beta, 5),
  "beta Friday week 5 uses post-score weekend close capture"
);
assert(
  usesSameDayCloseCapture(sdaiBeta, 1),
  "SDAI week 1 (Mon) uses same-day pre-score close capture"
);

const standardFinalize = computeWeekFinalizeAt(
  standard,
  1,
  zonedDateTimeFromIso("2026-06-29", 10, 0)
);
assert(
  standardFinalize.getTime() === zonedDateTimeFromIso("2026-07-06", 6, 0).getTime(),
  "standard week 1 from Mon Jun 29 finalizes Mon Jul 6 6 AM"
);

assert(
  !isPastFinalizeAt(
    zonedDateTimeFromIso("2026-07-06", 6, 0).toISOString(),
    zonedDateTimeFromIso("2026-07-06", 5, 59)
  ),
  "one minute before finalize is not past"
);
assert(
  isPastFinalizeAt(
    zonedDateTimeFromIso("2026-07-06", 6, 0).toISOString(),
    zonedDateTimeFromIso("2026-07-06", 6, 0)
  ),
  "at finalize moment is past"
);

const pick = {
  id: "p1",
  pick_type: "stock",
  symbol: "AAPL",
  shares: 10,
  price_at_pick: 100,
} as DraftPick;

const livePrices = new Map([["AAPL", 110]]);
const baseline = {
  valueAtOpen: 1000,
  valueAtClose: null,
  stockValueAtFridayClose: 1050,
};

assert(
  resolveHybridScoringValue(pick, livePrices, baseline, true) === 1050,
  "hybrid uses Friday stock close value"
);
assert(
  resolveHybridScoringValue(pick, livePrices, baseline, false) === 1100,
  "live mode uses current stock price"
);

const baselineMap = new Map([["p1", baseline]]);
assert(baselinesHaveFridayClose(baselineMap), "detects Friday close baselines");

console.log("\nAll season finalize tests passed.");

/**
 * SDPL season calendar unit tests.
 * Run: npx --yes tsx scripts/test-season-calendar.ts
 */
import {
  assertFreeAgencyOpen,
  assertLineupUnlocked,
  getSeasonCalendarState,
  isBetaFridayWeekDate,
  isFreeAgencyOpen,
  isLineupLocked,
  resolveSeasonSettings,
  SeasonCalendarError,
} from "../src/lib/season/calendar";
import {
  SDPL_FINALS_WEEK,
  SDPL_REGULAR_SEASON_WEEKS,
  SDPL_SEMIFINAL_WEEK,
  SDPL_TOTAL_SEASON_WEEKS,
} from "../src/lib/season/constants";
import {
  isSdplSeasonRulesLeague,
  isSportsSimLeague,
} from "../src/lib/season/sdpl-league";
import type { SeasonSettings } from "../src/lib/season/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok:", message);
}

/** Build a Date at Eastern wall time (handles EDT/EST via align loop). */
function et(y: number, m: number, d: number, h: number, min: number): Date {
  const utcGuess = Date.UTC(y, m - 1, d, h, min);
  let candidate = new Date(utcGuess);
  for (let i = 0; i < 6; i++) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(candidate);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    if (hour === h && minute === min) return candidate;
    candidate = new Date(candidate.getTime() + ((h - hour) * 60 + (min - minute)) * 60_000);
  }
  return candidate;
}

const sdpl4 = { formatType: "standard", playerCount: 4 };
const sdpl12 = { formatType: "standard", playerCount: 12 };
const sdfl = { formatType: "sports_league", sportsLeagueId: "sdfl", playerCount: 32 };
const sdpl2 = { formatType: "standard", playerCount: 2 };

const standardSettings = resolveSeasonSettings(sdpl4);
const betaSettings: SeasonSettings = resolveSeasonSettings(sdpl4, {
  season_format: "beta_daily",
  regular_season_weeks: 11,
  week_calendar: [
    { week: 5, date: "2026-07-03" },
    { week: 6, date: "2026-07-06" },
  ],
});
const sportsSettings = resolveSeasonSettings(sdfl);

// --- Scope gates ---
assert(isSdplSeasonRulesLeague(sdpl4), "4-player standard league is SDPL");
assert(isSdplSeasonRulesLeague(sdpl12), "12-player standard league is SDPL");
assert(!isSdplSeasonRulesLeague(sdfl), "SDFL sports-sim is not SDPL");
assert(isSportsSimLeague(sdfl), "SDFL detected as sports-sim");
assert(!isSdplSeasonRulesLeague(sdpl2), "2-player league excluded from SDPL rules");
assert(!sportsSettings.rulesApply, "sports-sim settings have rulesApply=false");
assert(standardSettings.rulesApply, "SDPL standard settings have rulesApply=true");
assert(betaSettings.seasonFormat === "beta_daily", "beta settings parsed");

// --- Season length constants ---
assert(SDPL_REGULAR_SEASON_WEEKS === 11, "11 regular season weeks");
assert(SDPL_TOTAL_SEASON_WEEKS === 13, "13 total weeks");
assert(SDPL_SEMIFINAL_WEEK === 12, "semifinals week 12");
assert(SDPL_FINALS_WEEK === 13, "finals week 13");

// --- Lineup lock (standard SDPL) ---
assert(
  isLineupLocked(et(2025, 6, 25, 10, 0), standardSettings),
  "Wed 10:00 AM ET locked"
);
assert(
  !isLineupLocked(et(2025, 6, 25, 16, 0), standardSettings),
  "Wed 4:00 PM ET unlocked"
);
assert(
  !isLineupLocked(et(2025, 6, 25, 8, 0), standardSettings),
  "Wed 8:00 AM ET unlocked"
);
assert(
  isLineupLocked(et(2025, 6, 28, 12, 0), standardSettings),
  "Sat 12:00 PM ET locked (weekend lock window)"
);
assert(
  !isLineupLocked(et(2025, 6, 28, 17, 0), standardSettings),
  "Sat 5:00 PM ET unlocked"
);
assert(
  !isLineupLocked(et(2025, 6, 25, 10, 0), sportsSettings),
  "sports-sim never locked"
);

// --- Standard FA window ---
assert(
  !isFreeAgencyOpen(et(2025, 6, 25, 10, 0), standardSettings),
  "Wed 10 AM FA closed"
);
assert(
  isFreeAgencyOpen(et(2025, 6, 28, 10, 0), standardSettings),
  "Sat 10 AM FA open"
);
assert(
  isFreeAgencyOpen(et(2025, 6, 29, 15, 0), standardSettings),
  "Sun 3 PM FA open"
);
assert(
  isFreeAgencyOpen(et(2025, 6, 30, 8, 0), standardSettings),
  "Mon 8 AM FA still open"
);
assert(
  !isFreeAgencyOpen(et(2025, 6, 30, 10, 0), standardSettings),
  "Mon 10 AM FA closed"
);
assert(
  isFreeAgencyOpen(et(2025, 6, 25, 10, 0), sportsSettings),
  "sports-sim FA always open"
);

// --- Weekend overlap: FA open while matchup still live (Sat during weekly window) ---
assert(
  isFreeAgencyOpen(et(2025, 6, 28, 11, 0), standardSettings) &&
    isLineupLocked(et(2025, 6, 28, 11, 0), standardSettings),
  "Sat 11 AM: FA open AND lineup locked simultaneously (intentional)"
);

// --- Beta daily FA ---
assert(
  !isFreeAgencyOpen(et(2025, 6, 30, 10, 0), betaSettings),
  "beta Mon 10 AM FA closed"
);
assert(
  isFreeAgencyOpen(et(2025, 6, 30, 17, 0), betaSettings),
  "beta Mon 5 PM FA open"
);
assert(
  isFreeAgencyOpen(et(2025, 6, 28, 11, 0), betaSettings),
  "beta Sat 11 AM FA open (weekend)"
);
assert(
  isFreeAgencyOpen(et(2025, 7, 4, 20, 0), betaSettings),
  "beta Fri Jul 4 evening FA open (Fri 4PM window through weekend)"
);

// --- Assert helpers ---
try {
  assertLineupUnlocked(et(2025, 6, 25, 10, 0), standardSettings);
  assert(false, "assertLineupUnlocked should throw when locked");
} catch (err) {
  assert(
    err instanceof SeasonCalendarError && err.code === "LINEUP_LOCKED",
    "assertLineupUnlocked throws LINEUP_LOCKED"
  );
}

try {
  assertFreeAgencyOpen(et(2025, 6, 25, 10, 0), standardSettings);
  assert(false, "assertFreeAgencyOpen should throw when closed");
} catch (err) {
  assert(
    err instanceof SeasonCalendarError && err.code === "FA_CLOSED",
    "assertFreeAgencyOpen throws FA_CLOSED"
  );
}

assertLineupUnlocked(et(2025, 6, 25, 17, 0), standardSettings);
assertFreeAgencyOpen(et(2025, 6, 28, 12, 0), standardSettings);
assertLineupUnlocked(et(2025, 6, 25, 10, 0), sportsSettings);

// --- Calendar state payload ---
const state = getSeasonCalendarState(et(2025, 6, 25, 10, 30), standardSettings);
assert(state.rulesApply && state.lineupLocked && !state.freeAgencyOpen, "state at Wed 10:30");
assert(state.lineupLockMessage !== null, "lineup lock message set");
assert(state.freeAgencyMessage !== null, "FA closed message set");

const sportsState = getSeasonCalendarState(et(2025, 6, 25, 10, 30), sportsSettings);
assert(
  !sportsState.rulesApply && !sportsState.lineupLocked && sportsState.freeAgencyOpen,
  "sports-sim unrestricted state"
);

// --- Beta Friday week detection (2026 calendar matches SDAI-00039 schedule) ---
assert(isBetaFridayWeekDate("2026-07-03"), "Jul 3 2026 is Friday (beta week 5)");
assert(!isBetaFridayWeekDate("2026-07-06"), "Jul 6 2026 is Monday not Friday");
assert(!isBetaFridayWeekDate("2025-07-03"), "Jul 3 2025 is Thursday not Friday");

console.log("\nAll season calendar tests passed.");

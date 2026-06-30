/**
 * Phase 6 visit-vs-cron scoring scope checks.
 * Run: npx --yes tsx scripts/test-phase6-scoring-visit.ts
 */
import { isSdplSeasonRulesLeague } from "../src/lib/season/sdpl-league";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok:", message);
}

const sdpl4Ai = { formatType: "standard", playerCount: 4 };
const sdpl12Human = { formatType: "standard", playerCount: 12 };
const sdfl = { formatType: "sports_league", sportsLeagueId: "sdfl", playerCount: 32 };
const sdhl = { formatType: "sports_league", sportsLeagueId: "sdhl", playerCount: 30 };

assert(isSdplSeasonRulesLeague(sdpl4Ai), "4-player AI league uses SDPL calendar");
assert(isSdplSeasonRulesLeague(sdpl12Human), "12-player human league uses SDPL calendar");
assert(!isSdplSeasonRulesLeague(sdfl), "SDFL sports-sim excluded from SDPL cron gates");
assert(!isSdplSeasonRulesLeague(sdhl), "SDHL sports-sim excluded from SDPL cron gates");

console.log("\nPhase 6 scope checks passed.");

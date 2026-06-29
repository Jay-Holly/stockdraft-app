/**
 * SDPL playoff bracket unit tests.
 * Run: npx --yes tsx scripts/test-sdpl-playoffs.ts
 */
import {
  SDPL_FINALS_WEEK,
  SDPL_SEMIFINAL_WEEK,
  buildFourTeamSemifinals,
  buildPlayoffFinalsWeek,
  buildThirdPlaceGame,
  formatPlayoffRoundLabel,
  isSdplRegularSeasonComplete,
  partitionSemifinalResults,
} from "../src/lib/matchup/schedule";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok:", message);
}

const t1 = "11111111-1111-1111-1111-111111111111";
const t2 = "22222222-2222-2222-2222-222222222222";
const t3 = "33333333-3333-3333-3333-333333333333";
const t4 = "44444444-4444-4444-4444-444444444444";

assert(isSdplRegularSeasonComplete(11, 11), "week 11 completes 11-week regular season");
assert(!isSdplRegularSeasonComplete(10, 11), "week 10 is still regular season");

const semis = buildFourTeamSemifinals(SDPL_SEMIFINAL_WEEK, [t1, t2, t3, t4]);
assert(semis.length === 2, "semis insert two games");
assert(semis[0].playoffRound === "semifinal", "semi round tag");
assert(semis[0].homeUserId === t1 && semis[0].awayUserId === t4, "1v4 semifinal");
assert(semis[1].homeUserId === t2 && semis[1].awayUserId === t3, "2v3 semifinal");
assert(semis[0].weekNumber === 12, "SDPL semifinal week is 12");

const third = buildThirdPlaceGame(SDPL_FINALS_WEEK, t1, t4);
assert(third.playoffRound === "third_place", "third place round tag");

const finalsWeek = buildPlayoffFinalsWeek(
  SDPL_FINALS_WEEK,
  [t1, t2],
  [t3, t4]
);
assert(finalsWeek.length === 2, "finals week has championship + 3rd place");
assert(
  finalsWeek.some((g) => g.playoffRound === "final") &&
    finalsWeek.some((g) => g.playoffRound === "third_place"),
  "finals week includes both rounds"
);

const partitioned = partitionSemifinalResults([
  { home_user_id: t1, away_user_id: t4, winner_user_id: t1 },
  { home_user_id: t2, away_user_id: t3, winner_user_id: t3 },
]);
assert(partitioned?.winners[0] === t1 && partitioned?.winners[1] === t3, "semi winners");
assert(partitioned?.losers[0] === t4 && partitioned?.losers[1] === t2, "semi losers");

assert(formatPlayoffRoundLabel("third_place") === "3rd Place", "UI label for third place");
assert(formatPlayoffRoundLabel("final") === "Championship", "UI label for final");
assert(formatPlayoffRoundLabel("semifinal") === "Semifinal", "UI label for semifinal");

console.log("\nAll SDPL playoff tests passed.");

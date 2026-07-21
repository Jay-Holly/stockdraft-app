/**
 * One-time data repair: re-score matchups that were finalized as false
 * "ties" (winner_user_id null, home_score=0, away_score=0) because the
 * underlying roster_week_baselines were corrupted by failed quote fetches
 * (fixed in commit 990e8d5, baselines repaired separately).
 *
 * Only touches matchups matching the exact corruption signature — real
 * completed matchups (any non-null winner, or any non-zero score) are
 * left untouched, and standings are incremented per-matchup (not
 * per-week), so already-correct results can never be double-counted.
 *
 * Run: npx --yes tsx scripts/repair-corrupted-matchups.ts [--dry-run] [--support-code=SDFL-00063]
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(__dirname, "..", ".env.local");
const envText = fs.readFileSync(envPath, "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const DRY_RUN = process.argv.includes("--dry-run");
const onlyCodeArg = process.argv.find((a) => a.startsWith("--support-code="));
const ONLY_CODE = onlyCodeArg ? onlyCodeArg.split("=")[1] : null;

async function main() {
  const { computeWeeklyScoreForUser } = await import(
    "../src/lib/matchup/league-teams"
  );
  const { legacyWinnerForHuman } = await import("../src/lib/matchup/types");
  const { matchupScoreEpsilon, parseLeagueScoringMode } = await import(
    "../src/lib/league/scoring-mode"
  );

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  let { data: leagues } = await supabase
    .from("leagues")
    .select("id, name, support_code, scoring_mode, owner_user_id, status")
    .eq("status", "active");

  if (ONLY_CODE) {
    leagues = (leagues ?? []).filter((l) => l.support_code === ONLY_CODE);
  }

  let totalRescored = 0;
  let totalStillTied = 0;

  for (const league of leagues ?? []) {
    const { data: matchups } = await supabase
      .from("league_matchups")
      .select(
        "id, week_number, home_user_id, away_user_id, home_score, away_score, status, winner_user_id"
      )
      .eq("league_id", league.id)
      .eq("status", "complete")
      .is("winner_user_id", null)
      .order("week_number", { ascending: true });

    const corrupted = (matchups ?? []).filter(
      (m) => Number(m.home_score) === 0 && Number(m.away_score) === 0
    );
    if (corrupted.length === 0) continue;

    console.log(
      `\n=== ${league.support_code} "${league.name}" — ${corrupted.length} corrupted matchups ===`
    );

    const scoringMode = parseLeagueScoringMode(league.scoring_mode);
    const epsilon = matchupScoreEpsilon(scoringMode);

    for (const m of corrupted) {
      if (!m.home_user_id || !m.away_user_id) continue;

      const homeScore = await computeWeeklyScoreForUser(
        m.home_user_id,
        league.id,
        scoringMode,
        { weekNumber: m.week_number, forceHybrid: false, supabase: supabase as any }
      );
      const awayScore = await computeWeeklyScoreForUser(
        m.away_user_id,
        league.id,
        scoringMode,
        { weekNumber: m.week_number, forceHybrid: false, supabase: supabase as any }
      );

      let winnerUserId: string | null;
      if (Math.abs(homeScore - awayScore) < epsilon) {
        winnerUserId = null;
      } else if (homeScore > awayScore) {
        winnerUserId = m.home_user_id;
      } else {
        winnerUserId = m.away_user_id;
      }

      const humanUserId = league.owner_user_id ?? null;
      let legacyWinner: string | null = null;
      if (humanUserId) {
        legacyWinner = legacyWinnerForHuman(
          { ...m, winner_user_id: winnerUserId, status: "complete" } as any,
          humanUserId
        );
      }

      console.log(
        `  wk${m.week_number}: home=${m.home_score}->${homeScore.toFixed(4)} away=${m.away_score}->${awayScore.toFixed(4)} winner=${winnerUserId ? winnerUserId.slice(0, 8) : "still tied"}`
      );

      if (winnerUserId == null) {
        totalStillTied++;
        if (!DRY_RUN) {
          await supabase
            .from("league_matchups")
            .update({
              home_score: homeScore,
              away_score: awayScore,
              scored_at: new Date().toISOString(),
            })
            .eq("id", m.id);
        }
        continue;
      }

      totalRescored++;

      if (!DRY_RUN) {
        const updatePayload: Record<string, unknown> = {
          home_score: homeScore,
          away_score: awayScore,
          winner_user_id: winnerUserId,
          scored_at: new Date().toISOString(),
        };
        if (
          humanUserId &&
          (m.home_user_id === humanUserId || m.away_user_id === humanUserId)
        ) {
          updatePayload.human_score_pct =
            humanUserId === m.home_user_id ? homeScore : awayScore;
          updatePayload.opponent_score_pct =
            humanUserId === m.home_user_id ? awayScore : homeScore;
          updatePayload.winner = legacyWinner;
        }

        await supabase
          .from("league_matchups")
          .update(updatePayload)
          .eq("id", m.id);

        const loserUserId =
          winnerUserId === m.home_user_id ? m.away_user_id : m.home_user_id;

        for (const [userId, isWinner] of [
          [winnerUserId, true],
          [loserUserId, false],
        ] as const) {
          const { data: row } = await supabase
            .from("league_standings")
            .select("wins, losses")
            .eq("league_id", league.id)
            .eq("user_id", userId)
            .maybeSingle();
          if (!row) continue;
          await supabase
            .from("league_standings")
            .update({
              wins: row.wins + (isWinner ? 1 : 0),
              losses: row.losses + (isWinner ? 0 : 1),
              updated_at: new Date().toISOString(),
            })
            .eq("league_id", league.id)
            .eq("user_id", userId);
        }
      }
    }
  }

  console.log(
    `\n${DRY_RUN ? "[DRY RUN] " : ""}Re-scored with a real winner: ${totalRescored}. Still a genuine tie after correction: ${totalStillTied}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

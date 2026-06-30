import { computeWeeklyAwards } from "@/lib/awards/compute";
import {
  applyWeeklyPoolRollover,
  ensureLeagueBonusPool,
  weeklyPoolAmount,
} from "@/lib/awards/pool";
import { loadAwardPickMetrics } from "@/lib/awards/metrics";
import {
  autoClaimAwardForUser,
  isLeagueBotUser,
} from "@/lib/awards/claim";
import { SDPL_REGULAR_SEASON_WEEKS } from "@/lib/season/constants";
import { isSdplSeasonRulesLeague } from "@/lib/season/sdpl-league";
import { createServiceClient } from "@/lib/supabase/service";

export type ComputeWeeklyAwardsResult = {
  skipped?: boolean;
  reason?: string;
  awardsComputed?: number;
  payoutsCreated?: number;
  actualPayouts?: number;
  weeklyPool?: number;
  errors?: string[];
};

export async function computeWeeklyAwardsForLeagueWeek(
  leagueId: string,
  weekNumber: number
): Promise<ComputeWeeklyAwardsResult> {
  const db = createServiceClient();
  if (weekNumber > SDPL_REGULAR_SEASON_WEEKS) {
    return {
      skipped: true,
      reason: "Playoff weeks do not run weekly bonus awards",
    };
  }

  const { data: league } = await db
    .from("leagues")
    .select("format_type, sports_league_id, player_count, status")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.status !== "active") {
    return { skipped: true, reason: "League is not active" };
  }

  if (
    !isSdplSeasonRulesLeague({
      formatType: league.format_type,
      sportsLeagueId: league.sports_league_id,
      playerCount: league.player_count,
    })
  ) {
    return { skipped: true, reason: "League is not SDPL-format" };
  }

  const { count: existingCount } = await db
    .from("weekly_award_results")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);

  if ((existingCount ?? 0) > 0) {
    return { skipped: true, reason: "Awards already computed for this week" };
  }

  const metrics = await loadAwardPickMetrics(db, leagueId, weekNumber);
  if (metrics.length === 0) {
    return {
      skipped: true,
      reason: "No finalized week baseline data available",
    };
  }

  const pool = await ensureLeagueBonusPool(db, leagueId);
  const weeklyPool = weeklyPoolAmount(pool);
  const awards = computeWeeklyAwards(metrics);
  const errors: string[] = [];
  let payoutsCreated = 0;
  let actualPayouts = 0;

  for (const award of awards) {
    const { data: resultRow, error: resultError } = await db
      .from("weekly_award_results")
      .insert({
        league_id: leagueId,
        week_number: weekNumber,
        award_key: award.awardKey,
        amount_usd: award.amountUsd,
        winner_user_id: award.winner?.userId ?? null,
        qualifying_pick_id: award.winner?.pickId ?? null,
        qualifying_symbol: award.winner?.symbol ?? null,
        detail_json: award.winner?.detail ?? {},
        no_winner_reason: award.noWinnerReason ?? null,
      })
      .select("id")
      .single();

    if (resultError || !resultRow) {
      errors.push(
        `${award.awardKey}: ${resultError?.message ?? "insert failed"}`
      );
      continue;
    }

    if (!award.winner) continue;

    actualPayouts += award.amountUsd;

    const { data: payoutRow, error: payoutError } = await db
      .from("weekly_award_payouts")
      .insert({
        award_result_id: resultRow.id,
        league_id: leagueId,
        user_id: award.winner.userId,
        amount_usd: award.amountUsd,
        status: "pending",
      })
      .select("id")
      .single();

    if (payoutError || !payoutRow) {
      errors.push(
        `${award.awardKey} payout: ${payoutError?.message ?? "insert failed"}`
      );
      continue;
    }

    payoutsCreated += 1;

    const isBot = await isLeagueBotUser(db, leagueId, award.winner.userId);
    if (!isBot) continue;

    const auto = await autoClaimAwardForUser(
      db,
      leagueId,
      award.winner.userId,
      award.amountUsd
    );

    if (auto.error) {
      errors.push(`${award.awardKey} bot auto-claim: ${auto.error}`);
      continue;
    }

    await db
      .from("weekly_award_payouts")
      .update({
        status: "auto_claimed",
        target_symbol: auto.symbol,
        target_pick_id: auto.pickId ?? null,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", payoutRow.id);
  }

  await applyWeeklyPoolRollover(db, leagueId, weeklyPool, actualPayouts);

  return {
    awardsComputed: awards.length,
    payoutsCreated,
    actualPayouts,
    weeklyPool,
    errors: errors.length > 0 ? errors : undefined,
  };
}

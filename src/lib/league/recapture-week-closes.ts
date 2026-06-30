import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { computeWeeklyScoreForUser } from "@/lib/matchup/league-teams";
import { parseLeagueScoringMode } from "@/lib/league/scoring-mode";
import { captureWeekCloseSnapshots } from "@/lib/roster/weekly";
import { createServiceClient } from "@/lib/supabase/service";

export type WeekBaselineSummary = {
  userId: string;
  baselineCount: number;
  openTotal: number;
  closeTotal: number;
  closeNullCount: number;
  closeEqualsOpenCount: number;
  aggregateGainPercent: number;
  storedMatchupScore: number | null;
};

export type RecaptureWeekClosesResult = {
  leagueId: string;
  supportCode: string;
  weekNumber: number;
  before: WeekBaselineSummary[];
  after: WeekBaselineSummary[];
};

async function summarizeWeekBaselines(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number,
  scoringMode: ReturnType<typeof parseLeagueScoringMode>
): Promise<Omit<WeekBaselineSummary, "storedMatchupScore">> {
  const { data: baselines } = await supabase
    .from("roster_week_baselines")
    .select("value_at_open, value_at_close")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("week_number", weekNumber);

  const openTotal = (baselines ?? []).reduce(
    (sum, row) => sum + Number(row.value_at_open ?? 0),
    0
  );
  const closeTotal = (baselines ?? []).reduce(
    (sum, row) => sum + Number(row.value_at_close ?? 0),
    0
  );
  const closeNullCount = (baselines ?? []).filter(
    (row) => row.value_at_close == null
  ).length;
  const closeEqualsOpenCount = (baselines ?? []).filter(
    (row) =>
      row.value_at_close != null &&
      Number(row.value_at_close) === Number(row.value_at_open)
  ).length;

  let aggregateGainPercent = 0;
  try {
    aggregateGainPercent = await computeWeeklyScoreForUser(
      userId,
      leagueId,
      scoringMode,
      { weekNumber, supabase }
    );
  } catch {
    aggregateGainPercent = NaN;
  }

  return {
    userId,
    baselineCount: baselines?.length ?? 0,
    openTotal,
    closeTotal,
    closeNullCount,
    closeEqualsOpenCount,
    aggregateGainPercent,
  };
}

async function loadStoredMatchupScore(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  weekNumber: number
): Promise<number | null> {
  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, home_score, away_score, status")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "complete");

  for (const matchup of matchups ?? []) {
    if (matchup.home_user_id === userId && matchup.home_score != null) {
      return Number(matchup.home_score);
    }
    if (matchup.away_user_id === userId && matchup.away_score != null) {
      return Number(matchup.away_score);
    }
  }

  return null;
}

async function summarizeAllRosters(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number,
  scoringMode: ReturnType<typeof parseLeagueScoringMode>
): Promise<WeekBaselineSummary[]> {
  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId);

  const summaries: WeekBaselineSummary[] = [];

  for (const draft of drafts ?? []) {
    const baseline = await summarizeWeekBaselines(
      supabase,
      leagueId,
      draft.user_id,
      weekNumber,
      scoringMode
    );
    const storedMatchupScore = await loadStoredMatchupScore(
      supabase,
      leagueId,
      draft.user_id,
      weekNumber
    );
    summaries.push({ ...baseline, storedMatchupScore });
  }

  return summaries.sort((a, b) => a.userId.localeCompare(b.userId));
}

export async function recaptureWeekCloseSnapshotsForLeague(options: {
  supportCode: string;
  weekNumber: number;
  supabase?: SupabaseClient;
}): Promise<RecaptureWeekClosesResult> {
  const supabase = options.supabase ?? createServiceClient();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, support_code, scoring_mode")
    .eq("support_code", options.supportCode)
    .maybeSingle();

  if (leagueError || !league) {
    throw new Error(
      leagueError?.message ?? `League not found: ${options.supportCode}`
    );
  }

  const scoringMode = parseLeagueScoringMode(league.scoring_mode);
  const before = await summarizeAllRosters(
    supabase,
    league.id,
    options.weekNumber,
    scoringMode
  );

  await captureWeekCloseSnapshots(
    league.id,
    options.weekNumber,
    supabase
  );

  const after = await summarizeAllRosters(
    supabase,
    league.id,
    options.weekNumber,
    scoringMode
  );

  return {
    leagueId: league.id,
    supportCode: league.support_code ?? options.supportCode,
    weekNumber: options.weekNumber,
    before,
    after,
  };
}

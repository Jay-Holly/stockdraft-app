import {
  AWARD_EMOJI,
  AWARD_LABELS,
  AWARD_WEEKLY_BASE_AMOUNT,
  type AwardKey,
} from "@/lib/awards/constants";
import { listPendingAwardPayouts } from "@/lib/awards/claim";
import { weeklyPoolAmount } from "@/lib/awards/pool";
import type { PendingAwardPayout } from "@/lib/awards/types";
import { getLeagueMemberTeamName } from "@/lib/league/server";
import { getSeasonWeekContext } from "@/lib/league/season-weeks";
import { isSdplSeasonRulesLeague } from "@/lib/season/sdpl-league";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import { requireSeasonLeague } from "@/lib/roster/server";
import { createClient } from "@/lib/supabase/server";

export type AwardWinnerView = {
  id: string;
  awardKey: AwardKey;
  awardLabel: string;
  awardEmoji: string;
  amountUsd: number;
  winnerUserId: string | null;
  winnerTeamName: string | null;
  qualifyingSymbol: string | null;
  noWinnerReason: string | null;
  isViewerWinner: boolean;
};

export type AwardsPoolView = {
  seasonBaseTotal: number;
  weeklyBaseAmount: number;
  draftSurchargeTotal: number;
  weeklyPoolAmount: number;
  rolloverBalance: number;
  playoffPoolBalance: number;
};

export type AwardsPageData = {
  leagueId: string;
  leagueName: string;
  currentWeek: number;
  viewWeek: number;
  availableWeeks: number[];
  awardsEnabled: boolean;
  weekHasResults: boolean;
  pool: AwardsPoolView;
  weekAwards: AwardWinnerView[];
  pending: PendingAwardPayout[];
  cryptoOptions: Array<{ symbol: string; name: string }>;
  viewerUserId: string;
};

function defaultPoolView(): AwardsPoolView {
  return {
    seasonBaseTotal: 100_000,
    weeklyBaseAmount: AWARD_WEEKLY_BASE_AMOUNT,
    draftSurchargeTotal: 0,
    weeklyPoolAmount: AWARD_WEEKLY_BASE_AMOUNT,
    rolloverBalance: 0,
    playoffPoolBalance: 0,
  };
}

function resolveViewWeek(
  requestedWeek: number | undefined,
  weeksWithResults: number[],
  currentWeek: number
): number {
  if (weeksWithResults.length === 0) {
    return Math.max(1, currentWeek - 1);
  }

  if (requestedWeek != null && weeksWithResults.includes(requestedWeek)) {
    return requestedWeek;
  }

  return weeksWithResults[weeksWithResults.length - 1];
}

export async function loadAwardsPageData(
  userId: string,
  options?: { weekNumber?: number }
): Promise<{ ok: true; data: AwardsPageData } | { ok: false; error: string }> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { ok: false, error: season.error };

  const { league } = season;
  const supabase = await createClient();
  const weekContext = await getSeasonWeekContext(league.id, userId);

  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("name, format_type, sports_league_id, player_count")
    .eq("id", league.id)
    .maybeSingle();

  const awardsEnabled = leagueRow
    ? isSdplSeasonRulesLeague({
        formatType: leagueRow.format_type,
        sportsLeagueId: leagueRow.sports_league_id,
        playerCount: leagueRow.player_count,
      })
    : false;

  const { data: resultWeekRows } = await supabase
    .from("weekly_award_results")
    .select("week_number")
    .eq("league_id", league.id)
    .order("week_number", { ascending: true });

  const availableWeeks = [
    ...new Set((resultWeekRows ?? []).map((row) => row.week_number)),
  ].sort((a, b) => a - b);

  const viewWeek = resolveViewWeek(
    options?.weekNumber,
    availableWeeks,
    weekContext.currentWeek
  );

  const { data: poolRow } = await supabase
    .from("league_bonus_pools")
    .select("*")
    .eq("league_id", league.id)
    .maybeSingle();

  const pool: AwardsPoolView = poolRow
    ? {
        seasonBaseTotal: Number(poolRow.season_base_total),
        weeklyBaseAmount: Number(poolRow.weekly_base_amount),
        draftSurchargeTotal: Number(poolRow.draft_surcharge_total),
        weeklyPoolAmount: weeklyPoolAmount(poolRow),
        rolloverBalance: Number(poolRow.rollover_balance),
        playoffPoolBalance: Number(poolRow.playoff_pool_balance),
      }
    : defaultPoolView();

  const [pendingAll, cryptoPool] = await Promise.all([
    listPendingAwardPayouts(userId),
    fetchCryptoPool(),
  ]);

  const pending = pendingAll.filter((row) => row.league_id === league.id);

  if (!awardsEnabled) {
    return {
      ok: true,
      data: {
        leagueId: league.id,
        leagueName: leagueRow?.name ?? league.name,
        currentWeek: weekContext.currentWeek,
        viewWeek,
        availableWeeks,
        awardsEnabled: false,
        weekHasResults: false,
        pool,
        weekAwards: [],
        pending,
        cryptoOptions: cryptoPool.map((coin) => ({
          symbol: coin.symbol,
          name: coin.name,
        })),
        viewerUserId: userId,
      },
    };
  }

  const { data: weekResults } = await supabase
    .from("weekly_award_results")
    .select("*")
    .eq("league_id", league.id)
    .eq("week_number", viewWeek)
    .order("amount_usd", { ascending: false });

  const winnerIds = [
    ...new Set(
      (weekResults ?? [])
        .map((row) => row.winner_user_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const winnerNames = new Map<string, string>();
  await Promise.all(
    winnerIds.map(async (winnerId) => {
      winnerNames.set(
        winnerId,
        await getLeagueMemberTeamName(league.id, winnerId)
      );
    })
  );

  const weekAwards: AwardWinnerView[] = (weekResults ?? []).map((row) => {
    const awardKey = row.award_key as AwardKey;
    return {
      id: row.id,
      awardKey,
      awardLabel: AWARD_LABELS[awardKey],
      awardEmoji: AWARD_EMOJI[awardKey],
      amountUsd: Number(row.amount_usd),
      winnerUserId: row.winner_user_id,
      winnerTeamName: row.winner_user_id
        ? winnerNames.get(row.winner_user_id) ?? "Unknown"
        : null,
      qualifyingSymbol: row.qualifying_symbol,
      noWinnerReason: row.no_winner_reason,
      isViewerWinner: row.winner_user_id === userId,
    };
  });

  return {
    ok: true,
    data: {
      leagueId: league.id,
      leagueName: leagueRow?.name ?? league.name,
      currentWeek: weekContext.currentWeek,
      viewWeek,
      availableWeeks,
      awardsEnabled: true,
      weekHasResults: weekAwards.length > 0,
      pool,
      weekAwards,
      pending,
      cryptoOptions: cryptoPool.map((coin) => ({
        symbol: coin.symbol,
        name: coin.name,
      })),
      viewerUserId: userId,
    },
  };
}

import {
  AWARD_EMOJI,
  AWARD_LABELS,
  AWARD_WEEKLY_BASE_AMOUNT,
  PLAYOFF_POOL_SEED,
  type AwardKey,
} from "@/lib/awards/constants";
import {
  listPendingAwardPayouts,
  listPendingPlayoffPayouts,
  sumPendingClaimAmountForLeague,
} from "@/lib/awards/claim";
import { poolSummaryFromRow } from "@/lib/awards/pool";
import type {
  PendingAwardPayout,
  PendingPlayoffPayout,
  PlayoffBonusPayoutRow,
  PlayoffPoolLedgerRow,
} from "@/lib/awards/types";
import { loadDraftStateDetailed } from "@/lib/draft/server";
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
  playoffSeedAmount: number;
  rolloverFromWeeks: number;
  playoffAllocationStatus: string;
};

export type PlayoffLedgerEntryView = {
  weekNumber: number | null;
  eventType: string;
  amountUsd: number;
  balanceAfter: number;
};

export type PlayoffPayoutBoardRow = {
  id: string;
  seedRank: number;
  sharePct: number;
  amountUsd: number;
  status: string;
  teamName: string;
  targetSymbol: string | null;
  isViewer: boolean;
};

export type StockPickOption = {
  pickId: string;
  symbol: string;
  pickType: "stock" | "bench";
  budgetSpent: number;
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
  playoffLedger: PlayoffLedgerEntryView[];
  playoffPayoutBoard: PlayoffPayoutBoardRow[];
  stockPickOptions: StockPickOption[];
  weekAwards: AwardWinnerView[];
  pending: PendingAwardPayout[];
  pendingPlayoff: PendingPlayoffPayout[];
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
    playoffPoolBalance: PLAYOFF_POOL_SEED,
    playoffSeedAmount: PLAYOFF_POOL_SEED,
    rolloverFromWeeks: 0,
    playoffAllocationStatus: "accumulating",
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

function stockPickOptionsFromState(
  picks: Array<{
    id: string;
    pick_type: string;
    symbol: string;
    budget_spent: number;
  }>
): StockPickOption[] {
  return picks
    .filter(
      (pick) =>
        (pick.pick_type === "stock" || pick.pick_type === "bench") &&
        pick.symbol.toUpperCase() !== "__OPEN__"
    )
    .map((pick) => ({
      pickId: pick.id,
      symbol: pick.symbol.toUpperCase(),
      pickType: pick.pick_type as "stock" | "bench",
      budgetSpent: pick.budget_spent,
    }))
    .sort((a, b) => b.budgetSpent - a.budgetSpent);
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

  const draftState = await loadDraftStateDetailed(userId, { leagueId: league.id });
  const stockPickOptions = draftState.ok
    ? stockPickOptionsFromState(draftState.state.picks)
    : [];

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

  const poolSummary = poolRow
    ? poolSummaryFromRow(poolRow)
    : {
        weeklyPoolAmount: AWARD_WEEKLY_BASE_AMOUNT,
        rolloverBalance: 0,
        playoffPoolBalance: PLAYOFF_POOL_SEED,
        playoffSeedAmount: PLAYOFF_POOL_SEED,
        rolloverFromWeeks: 0,
        totalAccumulatedPool: PLAYOFF_POOL_SEED,
      };

  const pool: AwardsPoolView = poolRow
    ? {
        seasonBaseTotal: Number(poolRow.season_base_total),
        weeklyBaseAmount: Number(poolRow.weekly_base_amount),
        draftSurchargeTotal: Number(poolRow.draft_surcharge_total),
        weeklyPoolAmount: poolSummary.weeklyPoolAmount,
        rolloverBalance: poolSummary.rolloverBalance,
        playoffPoolBalance: poolSummary.playoffPoolBalance,
        playoffSeedAmount: poolSummary.playoffSeedAmount,
        rolloverFromWeeks: poolSummary.rolloverFromWeeks,
        playoffAllocationStatus: poolRow.playoff_allocation_status,
      }
    : defaultPoolView();

  const [pendingAll, pendingPlayoff, cryptoPool, ledgerRows, allocationRow] =
    await Promise.all([
      listPendingAwardPayouts(userId),
      listPendingPlayoffPayouts(userId, league.id),
      fetchCryptoPool(),
      supabase
        .from("playoff_pool_ledger")
        .select("*")
        .eq("league_id", league.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("playoff_bonus_allocations")
        .select("id")
        .eq("league_id", league.id)
        .order("allocation_week", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const pending = pendingAll.filter((row) => row.league_id === league.id);

  const playoffLedger: PlayoffLedgerEntryView[] = (
    (ledgerRows.data ?? []) as PlayoffPoolLedgerRow[]
  ).map((row) => ({
    weekNumber: row.week_number,
    eventType: row.event_type,
    amountUsd: Number(row.amount_usd),
    balanceAfter: Number(row.balance_after),
  }));

  let playoffPayoutBoard: PlayoffPayoutBoardRow[] = [];
  if (allocationRow.data?.id) {
    const { data: boardRows } = await supabase
      .from("playoff_bonus_payouts")
      .select("*")
      .eq("allocation_id", allocationRow.data.id)
      .order("seed_rank", { ascending: true });

    const userIds = (boardRows ?? []).map((row) => row.user_id);
    const teamNames = new Map<string, string>();
    await Promise.all(
      userIds.map(async (memberId) => {
        teamNames.set(
          memberId,
          await getLeagueMemberTeamName(league.id, memberId)
        );
      })
    );

    playoffPayoutBoard = (boardRows ?? []).map((row) => {
      const payout = row as PlayoffBonusPayoutRow;
      return {
        id: payout.id,
        seedRank: payout.seed_rank,
        sharePct: Number(payout.share_pct),
        amountUsd: Number(payout.amount_usd),
        status: payout.status,
        teamName: teamNames.get(payout.user_id) ?? "Team",
        targetSymbol: payout.target_symbol,
        isViewer: payout.user_id === userId,
      };
    });
  }

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
        playoffLedger,
        playoffPayoutBoard,
        stockPickOptions,
        weekAwards: [],
        pending,
        pendingPlayoff,
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
      playoffLedger,
      playoffPayoutBoard,
      stockPickOptions,
      weekAwards,
      pending,
      pendingPlayoff,
      cryptoOptions: cryptoPool.map((coin) => ({
        symbol: coin.symbol,
        name: coin.name,
      })),
      viewerUserId: userId,
    },
  };
}

export type LeagueBonusSummary = {
  awardsEnabled: boolean;
  weeklyPoolAmount: number;
  rolloverBalance: number;
  playoffPoolBalance: number;
  totalBonusPool: number;
  pendingClaimTotalUsd: number;
  pendingClaimCount: number;
};

export async function loadLeagueBonusSummary(
  userId: string,
  leagueId: string,
  awardsEnabled: boolean
): Promise<LeagueBonusSummary> {
  if (!awardsEnabled) {
    return {
      awardsEnabled: false,
      weeklyPoolAmount: 0,
      rolloverBalance: 0,
      playoffPoolBalance: 0,
      totalBonusPool: 0,
      pendingClaimTotalUsd: 0,
      pendingClaimCount: 0,
    };
  }

  const supabase = await createClient();
  const { data: poolRow } = await supabase
    .from("league_bonus_pools")
    .select("*")
    .eq("league_id", leagueId)
    .maybeSingle();

  const summary = poolRow
    ? poolSummaryFromRow(poolRow)
    : {
        weeklyPoolAmount: AWARD_WEEKLY_BASE_AMOUNT,
        rolloverBalance: 0,
        playoffPoolBalance: PLAYOFF_POOL_SEED,
        playoffSeedAmount: PLAYOFF_POOL_SEED,
        rolloverFromWeeks: 0,
        totalAccumulatedPool: PLAYOFF_POOL_SEED,
      };

  const pending = await sumPendingClaimAmountForLeague(userId, leagueId);

  return {
    awardsEnabled: true,
    weeklyPoolAmount: summary.weeklyPoolAmount,
    rolloverBalance: summary.rolloverBalance,
    playoffPoolBalance: summary.playoffPoolBalance,
    totalBonusPool: summary.playoffPoolBalance,
    pendingClaimTotalUsd: pending.totalUsd,
    pendingClaimCount: pending.weeklyCount + pending.playoffCount,
  };
}

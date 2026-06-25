import { fetchDraftPool } from "@/lib/draft-pool/server";
import {
  calculateRosterGainPercent,
  getScoringPicks,
} from "@/lib/draft/ai-strategy";
import { isCryptoSymbol, isStockPickEligible } from "@/lib/draft/engine";
import { loadDraftStateDetailed, fetchBuyerCounts } from "@/lib/draft/server";
import type { DraftPick } from "@/lib/draft/types";
import {
  type AiLeague,
} from "@/lib/league/ai-league";
import {
  getAiLeagueById,
  getHumanLeagueById,
  resolveActiveAiLeague,
  resolveActiveLeagueId,
} from "@/lib/league/active-league";
import { BOT_BY_ID } from "@/lib/league/bots";
import {
  getHumanLeagueMembers,
  isHumanLeagueDraftFinished,
  type HumanLeague,
} from "@/lib/league/human-league";
import { getLeagueBotMembers } from "@/lib/league/league-bots";
import { getLeagueMemberTeamName, getLeagueOffBoardSymbols } from "@/lib/league/server";
import {
  parseLeagueScoringMode,
} from "@/lib/league/scoring-mode";
import {
  findHumanMatchupForWeek,
  getOpponentUserId,
  humanScoreFromMatchup,
  legacyWinnerForHuman,
  opponentScoreFromMatchup,
  type LeagueMatchupRow,
} from "@/lib/matchup/types";
import type { CryptoQuote } from "@/lib/coingecko/service";
import { createClient } from "@/lib/supabase/server";
import {
  buildHistoricalRosterPicks,
  partitionHistoricalRosterPicks,
} from "@/lib/roster/historical";
import {
  clampViewWeek,
  getSeasonWeekContext,
} from "@/lib/league/season-weeks";
import {
  computeGainPercent,
  fetchStockQuotes,
  getCryptoQuotesMap,
  getStockQuote,
  getSymbolQuote,
} from "@/lib/roster/quotes";
import {
  computeScoringWeekDollarGainForUser,
  computeScoringWeekGainPercent,
  computeScoringWeekGainPercentForUser,
  computeWeekDollarGain,
  computeWeekGainPercent,
  ensureWeekBaselines,
  getCurrentWeek,
  pickMarketValue,
} from "@/lib/roster/weekly";
import type {
  FreeAgentStock,
  FreeAgentsPageData,
  LeaguePageData,
  LeagueTeamStanding,
  MatchupLiveView,
  RosterPickView,
  RosterView,
} from "@/lib/roster/types";

export type SeasonLeague = AiLeague | HumanLeague;

export async function resolveSeasonLeague(
  userId: string,
  preferredLeagueId?: string | null
): Promise<SeasonLeague | null> {
  const leagueId = await resolveActiveLeagueId(userId, preferredLeagueId);
  if (!leagueId) return null;

  const humanLeague = await getHumanLeagueById(leagueId);
  if (humanLeague) {
    if (humanLeague.status === "waiting") return null;
    const finished = await isHumanLeagueDraftFinished(humanLeague, userId);
    return finished ? humanLeague : null;
  }

  const aiLeague = await getAiLeagueById(leagueId);
  if (!aiLeague || aiLeague.status === "drafting") return null;

  const draft = await loadDraftStateDetailed(userId, { leagueId: aiLeague.id });
  if (!draft.ok || draft.state.draft.status !== "complete") return null;

  return aiLeague;
}

export async function getSeasonLeague(
  userId: string,
  leagueId?: string | null
): Promise<AiLeague | null> {
  const league = await resolveActiveAiLeague(userId, leagueId);
  if (!league) return null;
  if (league.status === "drafting") return null;
  return league;
}

export async function requireSeasonLeague(
  userId: string,
  leagueId?: string | null
): Promise<{ league: SeasonLeague } | { error: string }> {
  const league = await resolveSeasonLeague(userId, leagueId);
  if (!league) {
    return {
      error:
        "No active season found. Finish your league draft to unlock the season hub.",
    };
  }

  return { league };
}

async function enrichPicks(picks: DraftPick[]): Promise<RosterPickView[]> {
  const stockSymbols = picks
    .filter(
      (p) =>
        !isCryptoSymbol(p.symbol) && p.symbol.toUpperCase() !== "__OPEN__"
    )
    .map((p) => p.symbol);
  const needsCrypto = picks.some((p) => isCryptoSymbol(p.symbol));

  const [stockQuotes, cryptoQuotes] = await Promise.all([
    fetchStockQuotes(stockSymbols),
    needsCrypto
      ? getCryptoQuotesMap()
      : Promise.resolve({} as Record<string, CryptoQuote>),
  ]);

  return picks.map((pick) => {
    const symbol = pick.symbol.toUpperCase();
    if (symbol === "__OPEN__") {
      return {
        ...pick,
        acquired_via: (pick as DraftPick & { acquired_via?: string }).acquired_via,
        currentPrice: 0,
        changePercent: 0,
        currentValue: 0,
        gainPercent: 0,
        weekOpenValue: 0,
        weekDollarGain: 0,
        weekGainPercent: 0,
        seasonDollarGain: 0,
        scores: false,
      };
    }

    let price = 0;
    let changePercent = 0;

    if (isCryptoSymbol(symbol)) {
      const quote = cryptoQuotes[symbol];
      price = quote?.price ?? 0;
      changePercent = quote?.changePercent ?? 0;
    } else {
      const quote = stockQuotes.get(symbol);
      price = quote?.price ?? 0;
      changePercent = quote?.changePercent ?? 0;
    }

    const scores = pick.pick_type === "stock" || pick.pick_type === "crypto";
    const currentValue = pick.shares > 0 ? pick.shares * price : 0;
    const gainPercent = scores
      ? computeGainPercent(pick.budget_spent, currentValue)
      : 0;

    return {
      ...pick,
      acquired_via: (pick as DraftPick & { acquired_via?: string }).acquired_via,
      currentPrice: price,
      changePercent,
      currentValue,
      gainPercent,
      weekOpenValue: 0,
      weekDollarGain: 0,
      weekGainPercent: 0,
      seasonDollarGain: 0,
      scores,
    };
  });
}

function isActiveCryptoPick(pick: RosterPickView): boolean {
  return pick.budget_spent > 0.01 || pick.shares > 0.000001;
}

export async function loadRosterView(
  userId: string,
  leagueId: string,
  options?: { weekNumber?: number }
): Promise<{ ok: true; roster: RosterView } | { ok: false; error: string }> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { ok: false, error: state.error };

  const supabase = await createClient();
  const weekContext = await getSeasonWeekContext(leagueId, userId);
  const viewWeek = clampViewWeek(
    options?.weekNumber ?? weekContext.currentWeek,
    weekContext.maxViewableWeek
  );
  const isHistorical = viewWeek < weekContext.currentWeek;

  const { data: league } = await supabase
    .from("leagues")
    .select("status, scoring_mode")
    .eq("id", leagueId)
    .maybeSingle();

  const scoringMode = parseLeagueScoringMode(league?.scoring_mode);
  const picks = state.state.picks.filter((p) => p.pick_type !== "skip");

  if (isHistorical) {
    const historicalPicks = await buildHistoricalRosterPicks(
      leagueId,
      userId,
      viewWeek,
      state.state.picks
    );
    const partitioned = partitionHistoricalRosterPicks(historicalPicks);
    const scoringWeekInputs = historicalPicks
      .filter((pick) => pick.pick_type === "stock" || pick.pick_type === "crypto")
      .map((pick) => ({
        currentValue: pick.currentValue,
        weekOpenValue: pick.weekOpenValue,
      }));

    return {
      ok: true,
      roster: {
        leagueId,
        leagueStatus: league?.status ?? "active",
        scoringMode,
        currentWeek: weekContext.currentWeek,
        viewWeek,
        isHistorical: true,
        availableWeeks: weekContext.availableWeeks,
        maxViewableWeek: weekContext.maxViewableWeek,
        starters: partitioned.starters,
        bench: partitioned.bench,
        crypto: partitioned.crypto,
        cryptoBuyerCounts: {},
        cryptoQuotes: {},
        scoringGainPercent: calculateRosterGainPercent(
          state.state.picks,
          new Map(
            historicalPicks
              .filter((pick) => pick.pick_type === "stock" || pick.pick_type === "crypto")
              .map((pick) => [pick.symbol.toUpperCase(), pick.currentPrice] as const)
          )
        ),
        scoringWeekGainPercent:
          computeScoringWeekGainPercent(scoringWeekInputs),
        scoringWeekDollarGain: scoringWeekInputs.reduce(
          (sum, pick) =>
            sum + computeWeekDollarGain(pick.currentValue, pick.weekOpenValue),
          0
        ),
        totalWeekDollarGain: historicalPicks.reduce(
          (sum, pick) => sum + pick.weekDollarGain,
          0
        ),
      },
    };
  }

  const enriched = await enrichPicks(picks);
  const buyerCounts = await fetchBuyerCounts(supabase, leagueId);
  const cryptoQuoteMap = await getCryptoQuotesMap();
  const cryptoQuotes: Record<string, { price: number; changePercent: number }> =
    {};
  for (const symbol of Object.keys(cryptoQuoteMap)) {
    const quote = cryptoQuoteMap[symbol];
    cryptoQuotes[symbol] = {
      price: quote?.price ?? 0,
      changePercent: quote?.changePercent ?? 0,
    };
  }
  const baselineMap = await ensureWeekBaselines(
    supabase,
    leagueId,
    userId,
    viewWeek,
    picks
  );

  const withWeekMetrics: RosterPickView[] = enriched.map((pick) => {
    const weekOpenValue =
      baselineMap.get(pick.id) ??
      pickMarketValue(pick, pick.currentPrice || pick.price_at_pick);
    const weekDollarGain = computeWeekDollarGain(
      pick.currentValue,
      weekOpenValue
    );
    const weekGainPercent = computeWeekGainPercent(
      pick.currentValue,
      weekOpenValue
    );
    const seasonDollarGain = computeWeekDollarGain(
      pick.currentValue,
      pick.budget_spent
    );
    const seasonGainPercent =
      pick.budget_spent > 0
        ? computeGainPercent(pick.budget_spent, pick.currentValue)
        : pick.gainPercent;

    return {
      ...pick,
      weekOpenValue,
      weekDollarGain,
      weekGainPercent,
      seasonDollarGain,
      gainPercent: seasonGainPercent,
    };
  });

  const quoteMap = new Map<string, number>();
  for (const pick of withWeekMetrics) {
    quoteMap.set(pick.symbol.toUpperCase(), pick.currentPrice);
  }

  const scoringWeekInputs = withWeekMetrics
    .filter((p) => p.pick_type === "stock" || p.pick_type === "crypto")
    .map((p) => ({
      currentValue: p.currentValue,
      weekOpenValue: p.weekOpenValue,
    }));

  const totalWeekDollarGain = withWeekMetrics.reduce(
    (sum, pick) => sum + pick.weekDollarGain,
    0
  );

  const scoringWeekDollarGain = scoringWeekInputs.reduce(
    (sum, pick) => sum + computeWeekDollarGain(pick.currentValue, pick.weekOpenValue),
    0
  );

  return {
    ok: true,
    roster: {
      leagueId,
      leagueStatus: league?.status ?? "active",
      scoringMode,
      currentWeek: weekContext.currentWeek,
      viewWeek,
      isHistorical: false,
      availableWeeks: weekContext.availableWeeks,
      maxViewableWeek: weekContext.maxViewableWeek,
      starters: withWeekMetrics.filter((p) => p.pick_type === "stock"),
      bench: withWeekMetrics.filter((p) => p.pick_type === "bench"),
      crypto: withWeekMetrics.filter(
        (p) => p.pick_type === "crypto" && isActiveCryptoPick(p)
      ),
      cryptoBuyerCounts: buyerCounts,
      cryptoQuotes,
      scoringGainPercent: calculateRosterGainPercent(
        state.state.picks,
        quoteMap
      ),
      scoringWeekGainPercent:
        computeScoringWeekGainPercent(scoringWeekInputs),
      scoringWeekDollarGain,
      totalWeekDollarGain,
    },
  };
}

async function computeTeamGain(
  userId: string,
  leagueId: string
): Promise<number> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return 0;

  const quotes = new Map<string, number>();
  for (const pick of getScoringPicks(state.state.picks)) {
    const { price } = await getSymbolQuote(pick.symbol);
    quotes.set(pick.symbol.toUpperCase(), price);
  }

  return calculateRosterGainPercent(state.state.picks, quotes);
}

export async function loadLeaguePageData(
  userId: string
): Promise<{ ok: true; data: LeaguePageData } | { ok: false; error: string }> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { ok: false, error: season.error };

  const { league } = season;
  const supabase = await createClient();
  const scoringMode = parseLeagueScoringMode(league.scoring_mode);

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name, avatar_color")
    .eq("id", userId)
    .single();

  const { data: standingsRow } = await supabase
    .from("league_standings")
    .select("wins, losses, current_week")
    .eq("league_id", league.id)
    .eq("user_id", userId)
    .maybeSingle();

  const currentWeek = standingsRow?.current_week ?? 1;

  const { data: leagueMeta } = await supabase
    .from("leagues")
    .select("league_type")
    .eq("id", league.id)
    .maybeSingle();

  const isHumanLeague = leagueMeta?.league_type === "human";
  const bots = await getLeagueBotMembers(league.id);
  const humanMembers = isHumanLeague
    ? await getHumanLeagueMembers(league.id)
    : [];

  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("*")
    .eq("league_id", league.id)
    .order("week_number", { ascending: true });

  const { data: allStandings } = await supabase
    .from("league_standings")
    .select("user_id, wins, losses")
    .eq("league_id", league.id);

  const humanGain = await computeTeamGain(userId, league.id);

  const botStandings: LeagueTeamStanding[] = await Promise.all(
    bots.map(async (bot) => {
      const botGain = await computeTeamGain(bot.id, league.id);
      const botProfile = BOT_BY_ID.get(bot.id);
      const row = allStandings?.find((entry) => entry.user_id === bot.id);

      return {
        userId: bot.id,
        teamName: bot.displayName,
        isHuman: false,
        isBot: true,
        avatarColor: botProfile?.avatarColor ?? "blue",
        wins: row?.wins ?? 0,
        losses: row?.losses ?? 0,
        seasonGainPercent: botGain,
      };
    })
  );

  const humanMemberStandings: LeagueTeamStanding[] = await Promise.all(
    humanMembers
      .filter((member) => member.userId !== userId)
      .map(async (member) => {
        const memberGain = await computeTeamGain(member.userId, league.id);
        const row = allStandings?.find((entry) => entry.user_id === member.userId);
        const { data: memberProfile } = await supabase
          .from("profiles")
          .select("avatar_color")
          .eq("id", member.userId)
          .maybeSingle();

        return {
          userId: member.userId,
          teamName: member.displayName,
          isHuman: true,
          isBot: false,
          avatarColor: memberProfile?.avatar_color ?? "blue",
          wins: row?.wins ?? 0,
          losses: row?.losses ?? 0,
          seasonGainPercent: memberGain,
        };
      })
  );

  const humanStanding: LeagueTeamStanding = {
    userId,
    teamName: await getLeagueMemberTeamName(league.id, userId),
    isHuman: true,
    isBot: false,
    avatarColor: profile?.avatar_color ?? "blue",
    wins: standingsRow?.wins ?? 0,
    losses: standingsRow?.losses ?? 0,
    seasonGainPercent: humanGain,
  };

  const standings = [humanStanding, ...humanMemberStandings, ...botStandings].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return b.seasonGainPercent - a.seasonGainPercent;
  });

  const currentMatchupRow = findHumanMatchupForWeek(
    (matchups ?? []) as LeagueMatchupRow[],
    userId,
    currentWeek
  );

  let currentMatchup: MatchupLiveView | null = null;

  if (currentMatchupRow) {
    const opponentId = getOpponentUserId(currentMatchupRow, userId);
    const opponentName = opponentId
      ? await getLeagueMemberTeamName(league.id, opponentId)
      : (currentMatchupRow.opponent_name ?? "Opponent");

    const [humanWeeklyPercent, opponentWeeklyPercent, humanWeeklyDollar, opponentWeeklyDollar] =
      opponentId
        ? await Promise.all([
            computeScoringWeekGainPercentForUser(userId, league.id),
            computeScoringWeekGainPercentForUser(opponentId, league.id),
            computeScoringWeekDollarGainForUser(userId, league.id),
            computeScoringWeekDollarGainForUser(opponentId, league.id),
          ])
        : [0, 0, 0, 0];

    currentMatchup = {
      weekNumber: currentMatchupRow.week_number,
      opponentName,
      opponentBotId: opponentId ?? currentMatchupRow.opponent_bot_id ?? "",
      status: currentMatchupRow.status,
      scoringMode,
      humanGainPercent: humanWeeklyPercent,
      opponentGainPercent: opponentWeeklyPercent,
      humanWeeklyScore:
        scoringMode === "dollar_gain"
          ? humanWeeklyDollar
          : humanWeeklyPercent,
      opponentWeeklyScore:
        scoringMode === "dollar_gain"
          ? opponentWeeklyDollar
          : opponentWeeklyPercent,
      winner: legacyWinnerForHuman(currentMatchupRow, userId),
      humanScored: humanScoreFromMatchup(currentMatchupRow, userId),
      opponentScored: opponentScoreFromMatchup(currentMatchupRow, userId),
    };
  }

  return {
    ok: true,
    data: {
      leagueId: league.id,
      leagueSupportCode: league.support_code,
      leagueName: league.name,
      leagueStatus: league.status,
      scoringMode,
      currentWeek,
      humanRecord: {
        wins: standingsRow?.wins ?? 0,
        losses: standingsRow?.losses ?? 0,
      },
      standings,
      currentMatchup,
    },
  };
}

export async function loadFreeAgentsPageData(
  userId: string
): Promise<
  { ok: true; data: FreeAgentsPageData } | { ok: false; error: string }
> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { ok: false, error: season.error };

  const { league } = season;
  const roster = await loadRosterView(userId, league.id);
  if (!roster.ok) return { ok: false, error: roster.error };

  const offBoard = await getLeagueOffBoardSymbols(league.id);

  const pool = await fetchDraftPool();
  const freeAgents: FreeAgentStock[] = [];

  for (const stock of pool) {
    const symbol = stock.symbol.toUpperCase();
    if (offBoard.has(symbol)) continue;

    const { price, changePercent } = await getStockQuote(symbol);
    if (!isStockPickEligible(symbol, price)) continue;

    freeAgents.push({
      symbol,
      name: stock.name,
      sector: stock.sector,
      price,
      changePercent,
    });
  }

  freeAgents.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    ok: true,
    data: {
      leagueId: league.id,
      freeAgents,
      benchSlots: roster.roster.bench.map((p) => ({
        pickId: p.id,
        symbol: p.symbol,
        isOpen: p.symbol.toUpperCase() === "__OPEN__",
      })),
    },
  };
}

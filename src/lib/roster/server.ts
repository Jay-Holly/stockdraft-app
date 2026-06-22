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
import { resolveActiveAiLeague } from "@/lib/league/active-league";
import { BOT_BY_ID } from "@/lib/league/bots";
import { getLeagueBotMembers } from "@/lib/league/league-bots";
import { getLeagueOffBoardSymbols } from "@/lib/league/server";
import type { CryptoQuote } from "@/lib/coingecko/service";
import type { CryptoSymbol } from "@/lib/market/symbols";
import { createClient } from "@/lib/supabase/server";
import {
  computeGainPercent,
  fetchStockQuotes,
  getCryptoQuotesMap,
  getStockQuote,
  getSymbolQuote,
} from "@/lib/roster/quotes";
import {
  computeScoringWeekGainPercent,
  computeWeekDollarGain,
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
): Promise<{ league: AiLeague } | { error: string }> {
  const league = await resolveActiveAiLeague(userId, leagueId);
  if (!league) {
    return { error: "No active season found. Complete your AI league draft first." };
  }

  if (league.status === "drafting") {
    return { error: "Your draft must be complete before managing your roster." };
  }

  const draft = await loadDraftStateDetailed(userId, { leagueId: league.id });
  if (!draft.ok || draft.state.draft.status !== "complete") {
    return { error: "Your draft must be complete before managing your roster." };
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
      : Promise.resolve({} as Record<CryptoSymbol, CryptoQuote>),
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
        scores: false,
      };
    }

    let price = 0;
    let changePercent = 0;

    if (isCryptoSymbol(symbol)) {
      const quote = cryptoQuotes[symbol as CryptoSymbol];
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
      scores,
    };
  });
}

function isActiveCryptoPick(pick: RosterPickView): boolean {
  return pick.budget_spent > 0.01 || pick.shares > 0.000001;
}

export async function loadRosterView(
  userId: string,
  leagueId: string
): Promise<{ ok: true; roster: RosterView } | { ok: false; error: string }> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { ok: false, error: state.error };

  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("status")
    .eq("id", leagueId)
    .maybeSingle();

  const picks = state.state.picks.filter((p) => p.pick_type !== "skip");
  const enriched = await enrichPicks(picks);
  const buyerCounts = await fetchBuyerCounts(supabase, leagueId);
  const cryptoQuoteMap = await getCryptoQuotesMap();
  const cryptoQuotes: Record<string, { price: number; changePercent: number }> =
    {};
  for (const symbol of Object.keys(cryptoQuoteMap)) {
    const quote = cryptoQuoteMap[symbol as CryptoSymbol];
    cryptoQuotes[symbol] = {
      price: quote?.price ?? 0,
      changePercent: quote?.changePercent ?? 0,
    };
  }
  const currentWeek = await getCurrentWeek(supabase, leagueId, userId);
  const baselineMap = await ensureWeekBaselines(
    supabase,
    leagueId,
    userId,
    currentWeek,
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

    return {
      ...pick,
      weekOpenValue,
      weekDollarGain,
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

  return {
    ok: true,
    roster: {
      leagueId,
      leagueStatus: league?.status ?? "active",
      currentWeek,
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
  const bots = await getLeagueBotMembers(league.id);

  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("*")
    .eq("league_id", league.id)
    .order("week_number", { ascending: true });

  const humanGain = await computeTeamGain(userId, league.id);

  const botStandings: LeagueTeamStanding[] = await Promise.all(
    bots.map(async (bot) => {
      const botGain = await computeTeamGain(bot.id, league.id);
      const botProfile = BOT_BY_ID.get(bot.id);
      let wins = 0;
      let losses = 0;

      for (const m of matchups ?? []) {
        if (m.opponent_bot_id !== bot.id || m.status !== "complete") continue;
        if (m.winner === "human") losses += 1;
        else if (m.winner === "opponent") wins += 1;
      }

      return {
        userId: bot.id,
        teamName: bot.displayName,
        isHuman: false,
        isBot: true,
        avatarColor: botProfile?.avatarColor ?? "blue",
        wins,
        losses,
        seasonGainPercent: botGain,
      };
    })
  );

  const humanStanding: LeagueTeamStanding = {
    userId,
    teamName: profile?.team_name ?? "My Team",
    isHuman: true,
    isBot: false,
    avatarColor: profile?.avatar_color ?? "blue",
    wins: standingsRow?.wins ?? 0,
    losses: standingsRow?.losses ?? 0,
    seasonGainPercent: humanGain,
  };

  const standings = [humanStanding, ...botStandings].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return b.seasonGainPercent - a.seasonGainPercent;
  });

  const currentMatchupRow =
    matchups?.find((m) => m.week_number === currentWeek) ?? null;

  let currentMatchup: MatchupLiveView | null = null;

  if (currentMatchupRow) {
    const opponentGain = await computeTeamGain(
      currentMatchupRow.opponent_bot_id,
      league.id
    );

    currentMatchup = {
      weekNumber: currentMatchupRow.week_number,
      opponentName: currentMatchupRow.opponent_name,
      opponentBotId: currentMatchupRow.opponent_bot_id,
      status: currentMatchupRow.status,
      humanGainPercent: humanGain,
      opponentGainPercent: opponentGain,
      winner: currentMatchupRow.winner,
      humanScored: currentMatchupRow.human_score_pct,
      opponentScored: currentMatchupRow.opponent_score_pct,
    };
  }

  return {
    ok: true,
    data: {
      leagueId: league.id,
      leagueSupportCode: league.support_code,
      leagueName: league.name,
      leagueStatus: league.status,
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

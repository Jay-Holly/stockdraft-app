import { getFallbackStockQuote } from "@/lib/market/fallback-quotes";
import {
  enrichDraftPoolStocks,
  filterDraftPoolStocks,
  getMarketCapRank,
  DRAFT_POOL_SECTORS,
  type DraftPoolStock,
} from "@/lib/market/draft-pool";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import { isCryptoPickEligible } from "@/lib/draft/engine";
import {
  getMyCryptoSymbols,
  getMyDraftedSymbols,
  getMyStockSymbols,
  getTurn,
  isCryptoSymbol,
  isStockPickEligible,
  summarizePicks,
  draftRulesModeFromFlag,
  getDraftRuleConstants,
} from "@/lib/draft/engine";
import type { DraftPick, DraftState } from "@/lib/draft/types";
import { CRYPTO_POOL } from "@/lib/draft/types";
import type { BotConfig, BotPersonality } from "@/lib/league/bots";
import { getStockHomerRegion, type HomerRegion } from "@/lib/league/homer-regions";
import {
  getCryptoQuote,
  getStockQuote,
} from "@/lib/roster/quotes";
import { filterScoringRosterPicks } from "@/lib/roster/crypto-picks";

export type AiPickDecision = {
  symbol: string;
  allocation?: number;
  price: number;
  isSearchPick?: boolean;
};

type StockCandidate = DraftPoolStock & { changePercent: number; price: number };

async function getCryptoPrice(symbol: string): Promise<number> {
  try {
    const { price } = await getCryptoQuote(symbol);
    return price;
  } catch (err) {
    console.error("getCryptoPrice failed:", err);
    return 0;
  }
}

function baseEligibleStocks(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>
): DraftPoolStock[] {
  return filterDraftPoolStocks(enrichDraftPoolStocks(pool), { filter: "All" }).filter(
    (s) => !offBoard.has(s.symbol) && !myDrafted.has(s.symbol)
  );
}

async function buildStockCandidates(
  stocks: DraftPoolStock[]
): Promise<StockCandidate[]> {
  const candidates: StockCandidate[] = [];
  for (const stock of stocks) {
    const { price, changePercent } = await getStockQuote(stock.symbol);
    if (!isStockPickEligible(stock.symbol, price)) continue;
    candidates.push({ ...stock, price, changePercent });
  }
  return candidates;
}

function buildStockCandidatesFast(stocks: DraftPoolStock[]): StockCandidate[] {
  const candidates: StockCandidate[] = [];
  for (const stock of stocks) {
    const fallback = getFallbackStockQuote(stock.symbol);
    const price = fallback?.price ?? 0;
    if (!isStockPickEligible(stock.symbol, price)) continue;
    candidates.push({
      ...stock,
      price,
      changePercent: fallback?.changePercent ?? 0,
    });
  }
  return candidates;
}

function pickHighestCapStock(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>
): DraftPoolStock | null {
  return (
    baseEligibleStocks(pool, offBoard, myDrafted)
      .filter((s) => (getMarketCapRank(s) ?? 9999) <= 503)
      .sort(
        (a, b) =>
          (getMarketCapRank(a) ?? 9999) - (getMarketCapRank(b) ?? 9999)
      )[0] ?? null
  );
}

function pickMidCapStock(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>,
  rankMin: number,
  rankMax: number
): DraftPoolStock | null {
  return (
    baseEligibleStocks(pool, offBoard, myDrafted)
      .filter((s) => {
        const rank = getMarketCapRank(s);
        return rank != null && rank >= rankMin && rank <= rankMax;
      })
      .sort(
        (a, b) =>
          (getMarketCapRank(a) ?? 9999) - (getMarketCapRank(b) ?? 9999)
      )[0] ?? pickHighestCapStock(pool, offBoard, myDrafted)
  );
}

function pickGamblerStock(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>
): DraftPoolStock | null {
  const candidates = baseEligibleStocks(pool, offBoard, myDrafted)
    .filter((s) => (getMarketCapRank(s) ?? 0) > 100)
    .sort(
      (a, b) =>
        (getMarketCapRank(b) ?? 0) - (getMarketCapRank(a) ?? 9999)
    );

  if (candidates.length > 0) return candidates[0];
  return pickMidCapStock(pool, offBoard, myDrafted, 250, 450);
}

function pickSleeperStock(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>
): DraftPoolStock | null {
  return pickMidCapStock(pool, offBoard, myDrafted, 101, 250);
}

function pickSectorStock(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>,
  sector: string
): DraftPoolStock | null {
  return (
    baseEligibleStocks(pool, offBoard, myDrafted)
      .filter((s) => s.sector === sector)
      .sort(
        (a, b) =>
          (getMarketCapRank(a) ?? 9999) - (getMarketCapRank(b) ?? 9999)
      )[0] ?? null
  );
}

function pickHomerStock(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>,
  region: HomerRegion
): DraftPoolStock | null {
  return (
    baseEligibleStocks(pool, offBoard, myDrafted)
      .filter((s) => getStockHomerRegion(s) === region)
      .sort(
        (a, b) =>
          (getMarketCapRank(a) ?? 9999) - (getMarketCapRank(b) ?? 9999)
      )[0] ?? pickHighestCapStock(pool, offBoard, myDrafted)
  );
}

function countSectorsInPicks(
  picks: DraftPick[],
  pool: DraftPoolStock[]
): Map<string, number> {
  const sectorBySymbol = new Map(
    pool.map((s) => [s.symbol.toUpperCase(), s.sector])
  );
  const counts = new Map<string, number>();
  for (const sector of DRAFT_POOL_SECTORS) {
    if (sector !== "All") counts.set(sector, 0);
  }
  for (const pick of picks) {
    if (pick.pick_type === "skip" || isCryptoSymbol(pick.symbol)) continue;
    const sector = sectorBySymbol.get(pick.symbol.toUpperCase());
    if (sector) counts.set(sector, (counts.get(sector) ?? 0) + 1);
  }
  return counts;
}

function pickDiversifierStock(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>,
  picks: DraftPick[]
): DraftPoolStock | null {
  const sectorCounts = countSectorsInPicks(picks, pool);
  const sortedSectors = [...sectorCounts.entries()].sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0])
  );

  for (const [sector] of sortedSectors) {
    const stock = pickSectorStock(pool, offBoard, myDrafted, sector);
    if (stock) return stock;
  }

  return pickHighestCapStock(pool, offBoard, myDrafted);
}

async function pickByMomentum(
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>,
  direction: "up" | "down",
  fast = false
): Promise<StockCandidate | null> {
  const eligible = baseEligibleStocks(pool, offBoard, myDrafted);
  const candidates = fast
    ? buildStockCandidatesFast(eligible)
    : await buildStockCandidates(eligible);

  const filtered =
    direction === "up"
      ? candidates.filter((s) => s.changePercent > 0)
      : candidates.filter((s) => s.changePercent < 0);

  const sorted = [...filtered].sort((a, b) =>
    direction === "up"
      ? b.changePercent - a.changePercent
      : a.changePercent - b.changePercent
  );

  if (sorted.length > 0) return sorted[0];

  const fallback = [...candidates].sort((a, b) =>
    direction === "up"
      ? b.changePercent - a.changePercent
      : a.changePercent - b.changePercent
  );

  return fallback[0] ?? null;
}

async function stockDecisionFromPool(
  stock: DraftPoolStock | null,
  fast = false
): Promise<AiPickDecision | null> {
  if (!stock) return null;
  if (fast) {
    const fallback = getFallbackStockQuote(stock.symbol);
    const price = fallback?.price ?? 0;
    if (price <= 0 || !isStockPickEligible(stock.symbol, price)) return null;
    return { symbol: stock.symbol, price };
  }
  const { price } = await getStockQuote(stock.symbol);
  if (price <= 0 || !isStockPickEligible(stock.symbol, price)) return null;
  return { symbol: stock.symbol, price };
}

async function stockDecisionFromCandidate(
  candidate: StockCandidate | null
): Promise<AiPickDecision | null> {
  if (!candidate || candidate.price <= 0) return null;
  return { symbol: candidate.symbol, price: candidate.price };
}

async function defaultCryptoChunk(
  summary: ReturnType<typeof summarizePicks>,
  symbolIndex = 0,
  chunkSize = 50_000
): Promise<AiPickDecision | null> {
  const pool = await fetchCryptoPool();
  const symbols =
    pool.length > 0
      ? pool.map((coin) => coin.symbol)
      : ["BTC", "ETH", "SOL", "DOGE"];
  const symbol = symbols[symbolIndex] ?? symbols[0];
  const price = await getCryptoPrice(symbol);
  if (price <= 0 || !isCryptoPickEligible(symbol, price)) return null;
  const chunk = Math.min(summary.cryptoRemaining, chunkSize);
  return { symbol, allocation: chunk, price };
}

async function pickStockForPersonality(
  personality: BotPersonality,
  pool: DraftPoolStock[],
  offBoard: Set<string>,
  myDrafted: Set<string>,
  picks: DraftPick[],
  botConfig: BotConfig,
  benchPhase: boolean,
  fast = false
): Promise<AiPickDecision | null> {
  if (personality === "bench_hoarder" && benchPhase) {
    return stockDecisionFromPool(pickGamblerStock(pool, offBoard, myDrafted), fast);
  }

  if (personality === "bench_hoarder" && !benchPhase) {
    return stockDecisionFromPool(pickHighestCapStock(pool, offBoard, myDrafted), fast);
  }

  if (personality === "analyst" || personality === "day_trader") {
    return stockDecisionFromPool(pickHighestCapStock(pool, offBoard, myDrafted), fast);
  }

  if (personality === "gambler") {
    return stockDecisionFromPool(pickGamblerStock(pool, offBoard, myDrafted), fast);
  }

  if (personality === "sleeper") {
    return stockDecisionFromPool(pickSleeperStock(pool, offBoard, myDrafted), fast);
  }

  if (personality === "sector_loyalist" && botConfig.sector) {
    return stockDecisionFromPool(
      pickSectorStock(pool, offBoard, myDrafted, botConfig.sector) ??
        pickHighestCapStock(pool, offBoard, myDrafted),
      fast
    );
  }

  if (personality === "homer" && botConfig.region) {
    return stockDecisionFromPool(
      pickHomerStock(
        pool,
        offBoard,
        myDrafted,
        botConfig.region as HomerRegion
      ),
      fast
    );
  }

  if (personality === "diversifier") {
    return stockDecisionFromPool(
      pickDiversifierStock(pool, offBoard, myDrafted, picks),
      fast
    );
  }

  if (personality === "value_hunter") {
    return stockDecisionFromCandidate(
      await pickByMomentum(pool, offBoard, myDrafted, "down", fast)
    );
  }

  if (personality === "contrarian") {
    return stockDecisionFromCandidate(
      await pickByMomentum(pool, offBoard, myDrafted, "down", fast)
    );
  }

  if (personality === "momentum_chaser") {
    return stockDecisionFromCandidate(
      await pickByMomentum(pool, offBoard, myDrafted, "up", fast)
    );
  }

  if (personality === "crypto_king") {
    return stockDecisionFromPool(
      pickMidCapStock(pool, offBoard, myDrafted, 120, 280),
      fast
    );
  }

  return stockDecisionFromPool(pickHighestCapStock(pool, offBoard, myDrafted), fast);
}

export async function decideAiPick(
  personality: BotPersonality,
  state: DraftState,
  pool: DraftPoolStock[],
  botConfig: BotConfig = {},
  options?: { fast?: boolean }
): Promise<AiPickDecision | null> {
  const fast = options?.fast ?? false;
  const { turn, picks, leagueOffBoard, sportsSimDraftRules } = state;
  if (turn.type === "complete" || turn.type === "pushback_skip") return null;

  const rules = draftRulesModeFromFlag(sportsSimDraftRules);
  const summary = summarizePicks(picks, rules);
  const offBoard = new Set(leagueOffBoard);
  const myDrafted = sportsSimDraftRules
    ? getMyDraftedSymbols(picks)
    : getMyStockSymbols(picks);
  const myCrypto = getMyCryptoSymbols(picks);

  if (sportsSimDraftRules && turn.type === "open" && turn.canPickCrypto) {
    const sim = getDraftRuleConstants("sports_sim");
    const openSlotsLeft =
      sim.starterRounds - summary.stockPicks - summary.cryptoPicks;
    if (openSlotsLeft > 0) {
      const wantCrypto =
        personality === "crypto_king" ||
        (personality === "gambler" && summary.cryptoPicks === 0) ||
        (summary.stockPicks >= 7 && summary.cryptoPicks === 0);

      if (wantCrypto) {
        const symbol = "BTC";
        if (!myDrafted.has(symbol)) {
          const price = await getCryptoPrice(symbol);
          if (price > 0) {
            return { symbol, price };
          }
        }
      }
    }
  }

  if (!sportsSimDraftRules && turn.type === "crypto" && turn.canPickCrypto && summary.cryptoRemaining > 0) {
    return defaultCryptoChunk(summary, 0, summary.cryptoRemaining);
  }

  if (!sportsSimDraftRules && personality === "crypto_king") {
    const cryptoPicks = picks.filter((p) => p.pick_type === "crypto");
    const openRound = turn.round;

    if (
      turn.canPickCrypto &&
      summary.cryptoRemaining > 0 &&
      cryptoPicks.length === 0 &&
      openRound <= 2
    ) {
      const symbol = "BTC";
      const price = await getCryptoPrice(symbol);
      if (price <= 0) return null;
      return { symbol, allocation: CRYPTO_POOL, price };
    }

    if (turn.canPickStock) {
      return pickStockForPersonality(
        personality,
        pool,
        offBoard,
        myDrafted,
        picks,
        botConfig,
        false,
        fast
      );
    }

    if (turn.canPickCrypto && summary.cryptoRemaining > 0) {
      const symbol = "BTC";
      const price = await getCryptoPrice(symbol);
      if (price <= 0) return null;
      return { symbol, allocation: summary.cryptoRemaining, price };
    }
  }

  if (!sportsSimDraftRules && personality === "analyst") {
    if (turn.canPickStock) {
      return pickStockForPersonality(
        personality,
        pool,
        offBoard,
        myDrafted,
        picks,
        botConfig,
        turn.type === "bench",
        fast
      );
    }

    if (turn.canPickCrypto && summary.cryptoRemaining > 0) {
      return defaultCryptoChunk(summary, 0, 50_000);
    }
  }

  if (!sportsSimDraftRules && personality === "gambler") {
    if (turn.canPickStock) {
      return pickStockForPersonality(
        personality,
        pool,
        offBoard,
        myDrafted,
        picks,
        botConfig,
        turn.type === "bench",
        fast
      );
    }

    if (turn.canPickCrypto && summary.cryptoRemaining > 0) {
      return defaultCryptoChunk(summary, 1, 75_000);
    }
  }

  if (!sportsSimDraftRules && personality === "day_trader") {
    if (turn.canPickStock) {
      return pickStockForPersonality(
        personality,
        pool,
        offBoard,
        myDrafted,
        picks,
        botConfig,
        turn.type === "bench",
        fast
      );
    }

    if (turn.canPickCrypto && summary.cryptoRemaining > 0) {
      const cryptoIndex = picks.filter((p) => p.pick_type === "crypto").length % 4;
      return defaultCryptoChunk(summary, cryptoIndex, 25_000);
    }
  }

  if (turn.canPickStock) {
    return pickStockForPersonality(
      personality,
      pool,
      offBoard,
      myDrafted,
      picks,
      botConfig,
      turn.type === "bench",
      fast
    );
  }

  if (!sportsSimDraftRules && turn.canPickCrypto && summary.cryptoRemaining > 0) {
    return defaultCryptoChunk(summary, 0, 40_000);
  }

  return null;
}

export function isDraftStateComplete(state: DraftState): boolean {
  const rules = draftRulesModeFromFlag(state.sportsSimDraftRules);
  return (
    state.draft.status === "complete" ||
    getTurn(state.draft, state.picks, rules).type === "complete"
  );
}

export function getScoringPicks(picks: DraftPick[]): DraftPick[] {
  return filterScoringRosterPicks(picks);
}

export async function getQuoteMapForPicks(
  picks: DraftPick[]
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  for (const pick of getScoringPicks(picks)) {
    const symbol = pick.symbol.toUpperCase();
    if (prices.has(symbol)) continue;
    if (isCryptoSymbol(symbol)) {
      prices.set(symbol, await getCryptoPrice(symbol));
    } else {
      prices.set(symbol, (await getStockQuote(symbol)).price);
    }
  }
  return prices;
}

export function calculateRosterGainPercent(
  picks: DraftPick[],
  currentPrices: Map<string, number>
): number {
  const scoring = getScoringPicks(picks);
  if (scoring.length === 0) return 0;

  let totalCost = 0;
  let totalValue = 0;

  for (const pick of scoring) {
    const symbol = pick.symbol.toUpperCase();
    const current = currentPrices.get(symbol) ?? pick.price_at_pick;
    totalCost += pick.budget_spent;
    totalValue += pick.shares * current;
  }

  if (totalCost <= 0) return 0;
  return ((totalValue - totalCost) / totalCost) * 100;
}

export { summarizePicks };

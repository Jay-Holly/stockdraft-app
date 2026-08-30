import {
  primeDraftPriceScreen,
  screenPrice,
  screenQuote,
} from "@/lib/draft/price-screen";
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
  getSurchargePercent,
  getTurn,
  isCryptoSymbol,
  isStockPickEligible,
  summarizePicks,
  draftRulesModeFromFlag,
  getDraftRuleConstants,
} from "@/lib/draft/engine";
import type {
  CryptoBuyerCounts,
  DraftPick,
  DraftState,
} from "@/lib/draft/types";
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
    const screened = screenQuote(stock.symbol);
    const price = screened?.price ?? 0;
    if (!isStockPickEligible(stock.symbol, price)) continue;
    candidates.push({
      ...stock,
      price,
      changePercent: screened?.changePercent ?? 0,
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

/**
 * The price actually written onto a pick must come from the same quote source
 * the league values that position with, or the roster opens the season already
 * up or down. Fast mode screens candidates against the static fallback table
 * to avoid N network round trips inside the bot's time budget — that is fine
 * for *choosing* a stock, but the chosen one still needs one authoritative
 * lookup before it is recorded. Skipping it left bot teams holding positions
 * priced off a stale snapshot: one opened week 1 down $160,013 against a
 * roster it had paid $920,000 for.
 */
async function resolvePickPrice(
  symbol: string,
  screenedPrice: number
): Promise<number> {
  const { price } = await getStockQuote(symbol);
  return price > 0 ? price : screenedPrice;
}

async function stockDecisionFromPool(
  stock: DraftPoolStock | null,
  fast = false
): Promise<AiPickDecision | null> {
  if (!stock) return null;
  if (fast) {
    const screened = screenPrice(stock.symbol);
    if (screened <= 0 || !isStockPickEligible(stock.symbol, screened)) {
      return null;
    }
    const price = await resolvePickPrice(stock.symbol, screened);
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
  // Candidates built by buildStockCandidatesFast carry screened prices from
  // the price log — see price-screen.ts.
  // Re-resolve so the recorded price is the live one; a cache hit costs
  // nothing and a miss keeps the screened price rather than losing the turn.
  const price = await resolvePickPrice(candidate.symbol, candidate.price);
  if (price <= 0 || !isStockPickEligible(candidate.symbol, price)) return null;
  return { symbol: candidate.symbol, price };
}

async function defaultCryptoChunk(
  summary: ReturnType<typeof summarizePicks>,
  symbolIndex = 0,
  chunkSize = 50_000,
  buyerCounts: CryptoBuyerCounts = {}
): Promise<AiPickDecision | null> {
  const pool = await fetchCryptoPool();
  const symbols =
    pool.length > 0
      ? pool.map((coin) => coin.symbol)
      : ["BTC", "ETH", "SOL", "DOGE"];

  // Buy the coin that isn't marked up. Every bot used to take symbols[0] —
  // always BTC — no matter how many managers had already bought it, so the
  // bots drafting last paid the 40% and 80% surcharge tiers: one turned
  // $200,000 of budget into a $40,000 position. Ranking by surcharge makes
  // the bots spread out across the pool the way the tiers intend, and
  // symbolIndex still varies the choice between personalities.
  const ranked = [...symbols].sort((a, b) => {
    const bySurcharge =
      getSurchargePercent(buyerCounts[a.toUpperCase()] ?? 0) -
      getSurchargePercent(buyerCounts[b.toUpperCase()] ?? 0);
    return bySurcharge !== 0
      ? bySurcharge
      : symbols.indexOf(a) - symbols.indexOf(b);
  });

  const chunk = Math.min(summary.cryptoRemaining, chunkSize);

  // Start at the requested slot, then fall through the rest of the ranking so
  // an unpriced coin costs a cheaper alternative rather than the whole turn.
  for (let offset = 0; offset < ranked.length; offset++) {
    const symbol = ranked[(symbolIndex + offset) % ranked.length];
    const price = await getCryptoPrice(symbol);
    if (price > 0 && isCryptoPickEligible(symbol, price)) {
      return { symbol, allocation: chunk, price };
    }
  }

  return null;
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
  const fast = options?.fast ?? true;
  const { turn, picks, leagueOffBoard, sportsSimDraftRules, buyerCounts } =
    state;
  if (turn.type === "complete" || turn.type === "pushback_skip") return null;

  // Load the whole pool's prices once, up front, so the fast strategy paths
  // below can screen 502 symbols synchronously. Without this they screen
  // against an empty map, every stock prices at $0, nothing is eligible, and
  // the bot skips its pick — which is exactly what a live test draft produced
  // before this existed.
  if (fast) await primeDraftPriceScreen();

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
    return defaultCryptoChunk(summary, 0, summary.cryptoRemaining, buyerCounts);
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
      return defaultCryptoChunk(summary, 0, 50_000, buyerCounts);
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
      return defaultCryptoChunk(summary, 1, 75_000, buyerCounts);
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
      return defaultCryptoChunk(summary, cryptoIndex, 25_000, buyerCounts);
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
    return defaultCryptoChunk(summary, 0, 40_000, buyerCounts);
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

import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";
import { CRYPTO_SYMBOLS } from "@/lib/market/symbols";
import {
  BENCH_ROUNDS,
  CRYPTO_EARLY_MAX_ROUND,
  CRYPTO_FLEX_ROUNDS,
  CRYPTO_POOL,
  CRYPTO_SURCHARGE_TIERS,
  STOCK_BUDGET,
  STOCK_CAP,
  STOCK_ROUNDS,
  TOTAL_CAP,
  TOTAL_ROUNDS,
  type Draft,
  type DraftPick,
  type DraftSummary,
  type DraftTurn,
  type PickType,
} from "./types";

export function isCryptoSymbol(symbol: string): boolean {
  return (CRYPTO_SYMBOLS as readonly string[]).includes(symbol.toUpperCase());
}

export function isStockPickEligible(symbol: string, price: number): boolean {
  if (isCryptoSymbol(symbol)) return false;
  if (price < MIN_STOCK_PRICE_USD) return false;
  return true;
}

export function getSurchargePercent(buyerCount: number): number {
  const index = Math.min(buyerCount, CRYPTO_SURCHARGE_TIERS.length - 1);
  return CRYPTO_SURCHARGE_TIERS[index];
}

export function computeCryptoPick(
  allocation: number,
  price: number,
  buyerCount: number
) {
  const surchargePercent = getSurchargePercent(buyerCount);
  const effectiveValue = allocation * (1 - surchargePercent / 100);
  const shares = price > 0 ? effectiveValue / price : 0;

  return {
    surchargePercent,
    effectiveValue,
    shares,
    budgetSpent: allocation,
  };
}

export function computeStockPick(price: number) {
  const shares = price > 0 ? STOCK_BUDGET / price : 0;
  return { shares, budgetSpent: STOCK_BUDGET };
}

export function summarizePicks(picks: DraftPick[]): DraftSummary {
  const realPicks = picks.filter((p) => p.pick_type !== "skip");
  const stockSpent = realPicks
    .filter((p) => p.pick_type === "stock")
    .reduce((sum, p) => sum + p.budget_spent, 0);
  const cryptoSpent = realPicks
    .filter((p) => p.pick_type === "crypto")
    .reduce((sum, p) => sum + p.budget_spent, 0);

  return {
    stockSpent,
    cryptoSpent,
    totalSpent: stockSpent + cryptoSpent,
    stockPicks: realPicks.filter((p) => p.pick_type === "stock").length,
    benchPicks: realPicks.filter((p) => p.pick_type === "bench").length,
    cryptoPicks: realPicks.filter((p) => p.pick_type === "crypto").length,
    cryptoRemaining: CRYPTO_POOL - cryptoSpent,
    stockRemaining: STOCK_CAP - stockSpent,
  };
}

export function getMyStockSymbols(picks: DraftPick[]): Set<string> {
  return new Set(
    picks
      .filter((p) => p.pick_type !== "skip" && p.pick_type !== "crypto")
      .map((p) => p.symbol.toUpperCase())
  );
}

export function getMyDraftedSymbols(picks: DraftPick[]): Set<string> {
  return new Set(
    picks
      .filter((p) => p.pick_type !== "skip")
      .map((p) => p.symbol.toUpperCase())
  );
}

export function calculatePushback(
  cryptoPicksInStockPhase: DraftPick[]
): number {
  if (cryptoPicksInStockPhase.length === 0) return 0;

  const total = cryptoPicksInStockPhase.reduce(
    (sum, p) => sum + p.budget_spent,
    0
  );
  if (total < CRYPTO_POOL) return 0;

  if (cryptoPicksInStockPhase.length === 1) return 2;
  if (cryptoPicksInStockPhase.length === 2) return 1;
  return 0;
}

export function getTurn(draft: Draft, picks: DraftPick[]): DraftTurn {
  const summary = summarizePicks(picks);

  if (draft.status === "complete" || isDraftComplete(picks)) {
    return {
      type: "complete",
      round: draft.current_round,
      label: "Draft complete",
      canPickCrypto: false,
      stockBudget: 0,
      cryptoRemaining: summary.cryptoRemaining,
    };
  }

  const round = draft.current_round;

  if (summary.stockPicks < STOCK_ROUNDS) {
    if (draft.pushback_skips_remaining > 0) {
      return {
        type: "pushback_skip",
        round,
        label: `Round ${round} — pushback skip (${draft.pushback_skips_remaining} left)`,
        canPickCrypto: false,
        stockBudget: 0,
        cryptoRemaining: summary.cryptoRemaining,
      };
    }

    return {
      type: "stock",
      round,
      label: `Round ${round} — stock pick ($${formatCompact(STOCK_BUDGET)})`,
      canPickCrypto:
        round <= CRYPTO_EARLY_MAX_ROUND && summary.cryptoRemaining > 0,
      stockBudget: STOCK_BUDGET,
      cryptoRemaining: summary.cryptoRemaining,
    };
  }

  if (summary.benchPicks < BENCH_ROUNDS) {
    const benchRound = STOCK_ROUNDS + summary.benchPicks + 1;
    return {
      type: "bench",
      round: Math.max(round, benchRound),
      label: `Round ${Math.max(round, benchRound)} — bench pick (free)`,
      canPickCrypto:
        round <= CRYPTO_EARLY_MAX_ROUND && summary.cryptoRemaining > 0,
      stockBudget: 0,
      cryptoRemaining: summary.cryptoRemaining,
    };
  }

  if (summary.cryptoRemaining > 0) {
    const flexRound =
      STOCK_ROUNDS + BENCH_ROUNDS + summary.cryptoPicks + 1;
    return {
      type: "crypto_flex",
      round: Math.max(round, flexRound),
      label: `Round ${Math.max(round, flexRound)} — crypto flex`,
      canPickCrypto: true,
      stockBudget: 0,
      cryptoRemaining: summary.cryptoRemaining,
    };
  }

  return {
    type: "complete",
    round,
    label: "Draft complete",
    canPickCrypto: false,
    stockBudget: 0,
    cryptoRemaining: 0,
  };
}

export function isDraftComplete(picks: DraftPick[]): boolean {
  const summary = summarizePicks(picks);
  return (
    summary.stockPicks >= STOCK_ROUNDS &&
    summary.benchPicks >= BENCH_ROUNDS &&
    summary.cryptoRemaining <= 0
  );
}

export function getNextRoundAfterPick(
  draft: Draft,
  picks: DraftPick[],
  pickType: PickType
): number {
  const round = draft.current_round;

  if (pickType === "skip") {
    return round + 1;
  }

  return round + 1;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCompact(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return String(amount);
}

export function formatShares(shares: number): string {
  if (shares >= 1_000_000) return `${(shares / 1_000_000).toFixed(2)}M sh`;
  if (shares >= 1_000) return `${(shares / 1_000).toFixed(1)}K sh`;
  if (shares >= 1) return `${shares.toFixed(2)} sh`;
  if (shares >= 0.0001) return `${shares.toFixed(4)} sh`;
  return `${shares.toExponential(2)} sh`;
}

export {
  STOCK_ROUNDS,
  STOCK_BUDGET,
  STOCK_CAP,
  BENCH_ROUNDS,
  CRYPTO_FLEX_ROUNDS,
  TOTAL_ROUNDS,
  CRYPTO_POOL,
  TOTAL_CAP,
  CRYPTO_EARLY_MAX_ROUND,
};

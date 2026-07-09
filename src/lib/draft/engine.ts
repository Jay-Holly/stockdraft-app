import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";
import { isCryptoPoolSymbol } from "@/lib/crypto-pool/symbols";
import { isSportsSimLeague } from "@/lib/season/sdpl-league";
import {
  BENCH_ROUNDS,
  BENCH_START_ROUND,
  CRYPTO_POOL,
  CRYPTO_SURCHARGE_TIERS,
  OPEN_ROUNDS,
  STOCK_BUDGET,
  STOCK_CAP,
  STOCK_ROUNDS,
  TOTAL_CAP,
  TOTAL_ROUNDS,
  type Draft,
  type DraftPick,
  type DraftRulesMode,
  type DraftSummary,
  type DraftTurn,
  type PickType,
} from "./types";

export type { DraftRulesMode };

export function resolveDraftRulesMode(league: {
  formatType?: string | null;
  sportsLeagueId?: string | null;
}): DraftRulesMode {
  return isSportsSimLeague(league) ? "sports_sim" : "standard";
}

export function draftRulesModeFromFlag(
  sportsSimDraftRules?: boolean
): DraftRulesMode {
  return sportsSimDraftRules ? "sports_sim" : "standard";
}

function countOpenSlotPicks(
  summary: DraftSummary,
  rules: DraftRulesMode
): number {
  if (rules === "sports_sim") {
    return summary.stockPicks + summary.cryptoPicks;
  }
  return summary.stockPicks;
}

function openSlotsRemaining(
  summary: DraftSummary,
  rules: DraftRulesMode
): number {
  return Math.max(0, STOCK_ROUNDS - countOpenSlotPicks(summary, rules));
}

export function isCryptoSymbol(symbol: string): boolean {
  return isCryptoPoolSymbol(symbol);
}

/** Crypto is eligible when it is in the pool and has a live price. No per-unit floor. */
export function isCryptoPickEligible(symbol: string, price: number): boolean {
  return isCryptoPoolSymbol(symbol) && price > 0;
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

export function getMyCryptoSymbols(picks: DraftPick[]): Set<string> {
  return new Set(
    picks
      .filter((p) => p.pick_type === "crypto")
      .map((p) => p.symbol.toUpperCase())
  );
}

export function getMyDraftedSymbols(picks: DraftPick[]): Set<string> {
  return new Set(
    picks
      .filter(
        (p) =>
          p.pick_type !== "skip" && p.symbol.toUpperCase() !== "__OPEN__"
      )
      .map((p) => p.symbol.toUpperCase())
  );
}

export function getDuplicateRosterError(
  symbol: string,
  picks: DraftPick[],
  pickKind: "crypto" | "stock",
  rules: DraftRulesMode = "standard"
): string | null {
  if (pickKind === "crypto") {
    if (rules === "sports_sim") {
      const upper = symbol.toUpperCase();
      if (getMyCryptoSymbols(picks).has(upper)) {
        return `${upper} is already on your roster`;
      }
    }
    return null;
  }

  const upper = symbol.toUpperCase();
  if (getMyStockSymbols(picks).has(upper)) {
    return `${upper} is already on your roster`;
  }

  return null;
}

export function getOpenPhaseCryptoPicks(picks: DraftPick[]): DraftPick[] {
  return picks.filter(
    (p) => p.pick_type === "crypto" && p.round_number <= OPEN_ROUNDS
  );
}

export function isOpenPhaseComplete(
  picks: DraftPick[],
  rules: DraftRulesMode = "standard"
): boolean {
  const summary = summarizePicks(picks);
  return countOpenSlotPicks(summary, rules) >= STOCK_ROUNDS;
}

export function hasRosterStructureComplete(
  picks: DraftPick[],
  rules: DraftRulesMode = "standard"
): boolean {
  const summary = summarizePicks(picks);
  return (
    countOpenSlotPicks(summary, rules) >= STOCK_ROUNDS &&
    summary.benchPicks >= BENCH_ROUNDS
  );
}

export function isDraftComplete(
  picks: DraftPick[],
  rules: DraftRulesMode = "standard"
): boolean {
  if (rules === "sports_sim") {
    return hasRosterStructureComplete(picks, rules);
  }
  const summary = summarizePicks(picks);
  return hasRosterStructureComplete(picks, rules) && summary.cryptoRemaining <= 0;
}

export function calculatePushback(cryptoPicksInOpenPhase: DraftPick[]): number {
  if (cryptoPicksInOpenPhase.length === 0) return 0;

  const total = cryptoPicksInOpenPhase.reduce(
    (sum, p) => sum + p.budget_spent,
    0
  );
  if (total < CRYPTO_POOL) return 0;

  if (cryptoPicksInOpenPhase.length === 1) return 2;
  if (cryptoPicksInOpenPhase.length === 2) return 1;
  return 0;
}

function openTurnLabel(
  round: number,
  canPickStock: boolean,
  canPickCrypto: boolean,
  rules: DraftRulesMode
): string {
  if (rules === "sports_sim") {
    if (canPickStock && canPickCrypto) {
      return `Round ${round} — open pick (stock or crypto $${formatCompact(STOCK_BUDGET)})`;
    }
    return `Round ${round} — open pick`;
  }
  if (canPickStock && canPickCrypto) {
    return `Round ${round} — open pick (stock $${formatCompact(STOCK_BUDGET)} or crypto)`;
  }
  if (canPickStock) {
    return `Round ${round} — stock pick ($${formatCompact(STOCK_BUDGET)})`;
  }
  if (canPickCrypto) {
    return `Round ${round} — crypto pick (from flex pool)`;
  }
  return `Round ${round} — open pick`;
}

export function getTurn(
  draft: Draft,
  picks: DraftPick[],
  rules: DraftRulesMode = "standard"
): DraftTurn {
  const summary = summarizePicks(picks);
  const round = draft.current_round;

  if (draft.status === "complete" || isDraftComplete(picks, rules)) {
    return {
      type: "complete",
      round,
      label: "Draft complete",
      canPickStock: false,
      canPickCrypto: false,
      stockBudget: 0,
      cryptoRemaining: summary.cryptoRemaining,
    };
  }

  const inOpenPhase =
    round <= OPEN_ROUNDS && !isOpenPhaseComplete(picks, rules);

  if (inOpenPhase) {
    if (rules !== "sports_sim" && draft.pushback_skips_remaining > 0) {
      return {
        type: "pushback_skip",
        round,
        label: `Round ${round} — auto-skipped (crypto pushback)`,
        canPickStock: false,
        canPickCrypto: false,
        stockBudget: 0,
        cryptoRemaining: summary.cryptoRemaining,
      };
    }

    const openSlotsLeft = openSlotsRemaining(summary, rules);
    const canPickStock =
      rules === "sports_sim" ? openSlotsLeft > 0 : summary.stockPicks < STOCK_ROUNDS;
    const canPickCrypto =
      rules === "sports_sim"
        ? openSlotsLeft > 0
        : summary.cryptoRemaining > 0;

    return {
      type: "open",
      round,
      label: openTurnLabel(round, canPickStock, canPickCrypto, rules),
      canPickStock,
      canPickCrypto,
      stockBudget: canPickStock ? STOCK_BUDGET : 0,
      cryptoRemaining: summary.cryptoRemaining,
    };
  }

  if (summary.benchPicks < BENCH_ROUNDS) {
    const benchRound = Math.max(round, BENCH_START_ROUND);
    const canPickCrypto =
      rules === "sports_sim" ? false : summary.cryptoRemaining > 0;
    return {
      type: "bench",
      round: benchRound,
      label: canPickCrypto
        ? `Round ${benchRound} — bench pick or crypto (${formatMoney(summary.cryptoRemaining)} left)`
        : `Round ${benchRound} — bench pick (free)`,
      canPickStock: true,
      canPickCrypto,
      stockBudget: 0,
      cryptoRemaining: summary.cryptoRemaining,
    };
  }

  if (rules !== "sports_sim" && summary.cryptoRemaining > 0) {
    const cryptoRound = Math.max(round, BENCH_START_ROUND);
    return {
      type: "crypto",
      round: cryptoRound,
      label: `Spend remaining crypto (${formatMoney(summary.cryptoRemaining)})`,
      canPickStock: false,
      canPickCrypto: true,
      stockBudget: 0,
      cryptoRemaining: summary.cryptoRemaining,
    };
  }

  return {
    type: "complete",
    round,
    label: "Draft complete",
    canPickStock: false,
    canPickCrypto: false,
    stockBudget: 0,
    cryptoRemaining: summary.cryptoRemaining,
  };
}

export function getNextRoundAfterPick(
  draft: Draft,
  picks: DraftPick[],
  pickType: PickType,
  rules: DraftRulesMode = "standard"
): number {
  const round = draft.current_round;
  const summary = summarizePicks(picks);

  if (pickType === "skip") {
    if (round < OPEN_ROUNDS) {
      return round + 1;
    }
    return BENCH_START_ROUND;
  }

  if (pickType === "crypto") {
    if (rules === "sports_sim") {
      if (!isOpenPhaseComplete(picks, rules)) {
        if (round < OPEN_ROUNDS) {
          return round + 1;
        }
      }
      if (round >= BENCH_START_ROUND) {
        return round + 1;
      }
      return BENCH_START_ROUND;
    }

    if (summary.cryptoRemaining > 0) {
      return round;
    }
    if (!isOpenPhaseComplete(picks, rules)) {
      if (round < OPEN_ROUNDS) {
        return round + 1;
      }
    }
    if (round >= BENCH_START_ROUND) {
      return round + 1;
    }
    return BENCH_START_ROUND;
  }

  if (pickType === "bench") {
    if (round < BENCH_START_ROUND + BENCH_ROUNDS - 1) {
      return round + 1;
    }
    return round + 1;
  }

  if (pickType === "stock") {
    if (!isOpenPhaseComplete(picks, rules)) {
      if (round < OPEN_ROUNDS) {
        return round + 1;
      }
    }
    if (round >= BENCH_START_ROUND) {
      return round + 1;
    }
    return BENCH_START_ROUND;
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
  OPEN_ROUNDS,
  BENCH_START_ROUND,
  TOTAL_ROUNDS,
  CRYPTO_POOL,
  TOTAL_CAP,
};

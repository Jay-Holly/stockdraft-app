import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";
import { isCryptoPoolSymbol } from "@/lib/crypto-pool/symbols";
import { isSportsSimLeague } from "@/lib/season/sdpl-league";
import {
  getDraftRuleConstants,
  SPORTS_SIM_STARTER_BUDGET,
} from "@/lib/draft/draft-constants";
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

function countStarterSlotPicks(
  picks: DraftPick[],
  rules: DraftRulesMode
): number {
  const c = getDraftRuleConstants(rules);
  return picks.filter(
    (p) =>
      p.pick_type !== "skip" &&
      p.round_number <= c.starterRounds &&
      (p.pick_type === "stock" || p.pick_type === "crypto")
  ).length;
}

function countBenchSlotPicks(
  picks: DraftPick[],
  rules: DraftRulesMode
): number {
  const c = getDraftRuleConstants(rules);
  return picks.filter((p) => {
    if (p.pick_type === "skip") return false;
    if (p.round_number < c.benchStartRound || p.round_number > c.totalRounds) {
      return false;
    }
    return p.pick_type === "bench" || p.pick_type === "crypto";
  }).length;
}

function countOpenSlotPicks(
  summary: DraftSummary,
  rules: DraftRulesMode
): number {
  if (rules === "standard") {
    return summary.stockPicks;
  }
  return summary.stockPicks + summary.cryptoPicks;
}

function openSlotsRemaining(
  summary: DraftSummary,
  rules: DraftRulesMode
): number {
  const c = getDraftRuleConstants(rules);
  return Math.max(0, c.starterRounds - countOpenSlotPicks(summary, rules));
}

export function isCryptoSymbol(symbol: string): boolean {
  return isCryptoPoolSymbol(symbol);
}

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

export function computeSportsSimStarterPick(price: number) {
  const shares = price > 0 ? SPORTS_SIM_STARTER_BUDGET / price : 0;
  return { shares, budgetSpent: SPORTS_SIM_STARTER_BUDGET };
}

export function summarizePicks(
  picks: DraftPick[],
  rules: DraftRulesMode = "standard"
): DraftSummary {
  const realPicks = picks.filter((p) => p.pick_type !== "skip");
  const c = getDraftRuleConstants(rules);

  const starterPicks =
    rules === "sports_sim"
      ? realPicks.filter(
          (p) =>
            p.round_number <= c.starterRounds &&
            (p.pick_type === "stock" || p.pick_type === "crypto")
        )
      : realPicks.filter((p) => p.pick_type === "stock");

  const stockSpent = realPicks
    .filter((p) => p.pick_type === "stock")
    .reduce((sum, p) => sum + p.budget_spent, 0);
  const cryptoSpent = realPicks
    .filter((p) => p.pick_type === "crypto")
    .reduce((sum, p) => sum + p.budget_spent, 0);

  const starterSpent =
    rules === "sports_sim"
      ? starterPicks.reduce((sum, p) => sum + p.budget_spent, 0)
      : stockSpent;

  return {
    stockSpent: rules === "sports_sim" ? starterSpent : stockSpent,
    cryptoSpent: rules === "sports_sim" ? 0 : cryptoSpent,
    totalSpent: starterSpent + (rules === "sports_sim" ? 0 : cryptoSpent),
    stockPicks: realPicks.filter((p) => p.pick_type === "stock").length,
    benchPicks: realPicks.filter((p) => p.pick_type === "bench").length,
    cryptoPicks: realPicks.filter((p) => p.pick_type === "crypto").length,
    cryptoRemaining: CRYPTO_POOL - cryptoSpent,
    stockRemaining:
      (rules === "sports_sim" ? c.starterCap : STOCK_CAP) - starterSpent,
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
  const upper = symbol.toUpperCase();

  if (rules === "sports_sim") {
    if (getMyDraftedSymbols(picks).has(upper)) {
      return `${upper} is already on your roster`;
    }
    return null;
  }

  if (pickKind === "crypto") {
    return null;
  }

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
  if (rules === "sports_sim") {
    const c = getDraftRuleConstants(rules);
    return countStarterSlotPicks(picks, rules) >= c.starterRounds;
  }
  const summary = summarizePicks(picks, rules);
  return countOpenSlotPicks(summary, rules) >= STOCK_ROUNDS;
}

export function hasRosterStructureComplete(
  picks: DraftPick[],
  rules: DraftRulesMode = "standard"
): boolean {
  const c = getDraftRuleConstants(rules);
  if (rules === "sports_sim") {
    return (
      countStarterSlotPicks(picks, rules) >= c.starterRounds &&
      countBenchSlotPicks(picks, rules) >= c.benchRounds
    );
  }
  const summary = summarizePicks(picks, rules);
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
  const summary = summarizePicks(picks, rules);
  return (
    hasRosterStructureComplete(picks, rules) && summary.cryptoRemaining <= 0
  );
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

function sportsSimTurnLabel(round: number): string {
  const c = getDraftRuleConstants("sports_sim");
  if (round <= c.starterRounds) {
    return `Round ${round} — starter (stock or crypto $${formatCompact(c.starterBudget)})`;
  }
  if (round <= c.totalRounds) {
    return `Round ${round} — bench (stock or crypto, free)`;
  }
  return `Round ${round}`;
}

function openTurnLabel(
  round: number,
  canPickStock: boolean,
  canPickCrypto: boolean,
  rules: DraftRulesMode
): string {
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
  const summary = summarizePicks(picks, rules);
  const round = draft.current_round;
  const c = getDraftRuleConstants(rules);

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

  if (rules === "sports_sim") {
    if (round <= c.starterRounds) {
      return {
        type: "open",
        round,
        label: sportsSimTurnLabel(round),
        canPickStock: true,
        canPickCrypto: true,
        stockBudget: c.starterBudget,
        cryptoRemaining: 0,
      };
    }

    if (round <= c.totalRounds) {
      return {
        type: "bench",
        round,
        label: sportsSimTurnLabel(round),
        canPickStock: true,
        canPickCrypto: true,
        stockBudget: 0,
        cryptoRemaining: 0,
      };
    }

    return {
      type: "complete",
      round,
      label: "Draft complete",
      canPickStock: false,
      canPickCrypto: false,
      stockBudget: 0,
      cryptoRemaining: 0,
    };
  }

  const inOpenPhase =
    round <= OPEN_ROUNDS && !isOpenPhaseComplete(picks, rules);

  if (inOpenPhase) {
    if (draft.pushback_skips_remaining > 0) {
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

    const canPickStock = summary.stockPicks < STOCK_ROUNDS;
    const canPickCrypto = summary.cryptoRemaining > 0;

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
    const canPickCrypto = summary.cryptoRemaining > 0;
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

  if (summary.cryptoRemaining > 0) {
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
  const summary = summarizePicks(picks, rules);
  const c = getDraftRuleConstants(rules);

  if (rules === "sports_sim") {
    return Math.min(round + 1, c.totalRounds + 1);
  }

  if (pickType === "skip") {
    if (round < OPEN_ROUNDS) {
      return round + 1;
    }
    return BENCH_START_ROUND;
  }

  if (pickType === "crypto") {
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
  getDraftRuleConstants,
  livePicksPerTeamForFormat,
  SPORTS_SIM_BENCH_ROUNDS,
  SPORTS_SIM_BENCH_START_ROUND,
  SPORTS_SIM_PICKS_PER_TEAM,
  SPORTS_SIM_STARTER_BUDGET,
  SPORTS_SIM_STARTER_CAP,
  SPORTS_SIM_STARTER_ROUNDS,
  SPORTS_SIM_TOTAL_ROUNDS,
} from "@/lib/draft/draft-constants";

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

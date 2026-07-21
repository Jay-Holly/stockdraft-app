import type { DraftRulesMode } from "@/lib/draft/types";
import {
  BENCH_ROUNDS,
  BENCH_START_ROUND,
  CRYPTO_POOL,
  OPEN_ROUNDS,
  STOCK_BUDGET,
  STOCK_CAP,
  STOCK_ROUNDS,
  TOTAL_CAP,
  TOTAL_ROUNDS,
} from "@/lib/draft/types";

/** Sports-sim (SDFL/SDHL/SDBA/SDLB) — 10 starters + 3 bench = 13 picks per team. */
export const SPORTS_SIM_STARTER_ROUNDS = 10;
export const SPORTS_SIM_STARTER_BUDGET = 100_000;
export const SPORTS_SIM_STARTER_CAP = 1_000_000;
export const SPORTS_SIM_BENCH_ROUNDS = 3;
export const SPORTS_SIM_TOTAL_ROUNDS = 13;
export const SPORTS_SIM_BENCH_START_ROUND = 11;
export const SPORTS_SIM_PICKS_PER_TEAM = 13;

/** SDBA/SDHL/SDLB only (see isMultiAssetSimLeague) — the 10 starter slots split exactly 5 stock / 5 crypto. */
export const SPORTS_SIM_STARTER_STOCK_SLOTS = 5;
export const SPORTS_SIM_STARTER_CRYPTO_SLOTS = 5;

/** Begin bot provisioning this many ms before scheduled_draft_at (draft still starts on time). */
export const SPORTS_SIM_BOT_PROVISION_LEAD_MS = 8 * 60 * 1000;

export type DraftRuleConstants = {
  starterRounds: number;
  starterBudget: number;
  starterCap: number;
  benchRounds: number;
  totalRounds: number;
  benchStartRound: number;
  picksPerTeam: number;
  totalCap: number;
  /** Standard leagues only — open-phase round span. */
  openRounds: number;
};

export function getDraftRuleConstants(
  rules: DraftRulesMode = "standard"
): DraftRuleConstants {
  if (rules === "sports_sim") {
    return {
      starterRounds: SPORTS_SIM_STARTER_ROUNDS,
      starterBudget: SPORTS_SIM_STARTER_BUDGET,
      starterCap: SPORTS_SIM_STARTER_CAP,
      benchRounds: SPORTS_SIM_BENCH_ROUNDS,
      totalRounds: SPORTS_SIM_TOTAL_ROUNDS,
      benchStartRound: SPORTS_SIM_BENCH_START_ROUND,
      picksPerTeam: SPORTS_SIM_PICKS_PER_TEAM,
      totalCap: SPORTS_SIM_STARTER_CAP,
      openRounds: SPORTS_SIM_STARTER_ROUNDS,
    };
  }

  return {
    starterRounds: STOCK_ROUNDS,
    starterBudget: STOCK_BUDGET,
    starterCap: STOCK_CAP,
    benchRounds: BENCH_ROUNDS,
    totalRounds: TOTAL_ROUNDS,
    benchStartRound: BENCH_START_ROUND,
    picksPerTeam: TOTAL_ROUNDS,
    totalCap: TOTAL_CAP,
    openRounds: OPEN_ROUNDS,
  };
}

export function livePicksPerTeamForFormat(
  formatType?: string | null
): number {
  return formatType === "sports_league"
    ? SPORTS_SIM_PICKS_PER_TEAM
    : TOTAL_ROUNDS;
}

export function postDraftIrBaseRound(rules: DraftRulesMode): number {
  return getDraftRuleConstants(rules).totalRounds + 1;
}

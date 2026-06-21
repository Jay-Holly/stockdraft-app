export const STOCK_ROUNDS = 10;
export const STOCK_BUDGET = 80_000;
export const STOCK_CAP = 800_000;
export const BENCH_ROUNDS = 2;
export const OPEN_ROUNDS = 13;
export const BENCH_START_ROUND = OPEN_ROUNDS + 1;
export const TOTAL_ROUNDS = 15;
export const CRYPTO_POOL = 200_000;
export const TOTAL_CAP = 1_000_000;

/** @deprecated Use OPEN_ROUNDS */
export const CRYPTO_EARLY_MAX_ROUND = OPEN_ROUNDS;
/** @deprecated Crypto is picked during open rounds 1–13, not a separate flex phase */
export const CRYPTO_FLEX_ROUNDS = 0;

/** Surcharge % by buyer index: 1st=0%, 2nd=5%, 3rd=10%, 4th=20%, 5th=40%, 6th+=80% */
export const CRYPTO_SURCHARGE_TIERS = [0, 5, 10, 20, 40, 80] as const;

export type PickType = "stock" | "bench" | "crypto" | "skip";
export type DraftStatus = "in_progress" | "complete";

export type Draft = {
  id: string;
  user_id: string;
  league_id: string | null;
  status: DraftStatus;
  current_round: number;
  pushback_skips_remaining: number;
  safety_pick_symbol?: string | null;
  created_at: string;
  completed_at: string | null;
};

export type DraftPick = {
  id: string;
  draft_id: string;
  user_id: string;
  round_number: number;
  pick_type: PickType;
  symbol: string;
  price_at_pick: number;
  budget_spent: number;
  shares: number;
  surcharge_percent: number;
  effective_value: number;
  pick_order: number;
  created_at: string;
  is_auto_pick?: boolean;
  auto_pick_reason?: string | null;
  global_pick_number?: number | null;
  acquired_via?: "draft" | "waiver";
  updated_at?: string;
};

export type CryptoBuyerCounts = Record<string, number>;

export type TurnType = "open" | "bench" | "pushback_skip" | "complete";

export type DraftTurn = {
  type: TurnType;
  round: number;
  label: string;
  canPickStock: boolean;
  canPickCrypto: boolean;
  stockBudget: number;
  cryptoRemaining: number;
};

export type DraftSummary = {
  stockSpent: number;
  cryptoSpent: number;
  totalSpent: number;
  stockPicks: number;
  benchPicks: number;
  cryptoPicks: number;
  cryptoRemaining: number;
  stockRemaining: number;
};

export type DraftFeedEvent = {
  id: string;
  league_id: string;
  user_id: string;
  team_name: string;
  round_number: number;
  symbol: string;
  pick_type: string;
  budget_spent: number;
  surcharge_percent: number;
  global_pick_number: number;
  message: string;
  is_auto_pick: boolean;
  created_at: string;
};

export type LiveDraftView = {
  status: "waiting" | "in_progress" | "complete";
  onClockUserId: string | null;
  onClockTeamName: string | null;
  pickDeadlineAt: string | null;
  isMyTurn: boolean;
  currentPickIndex: number;
  totalPickSlots: number;
  globalPickNumber: number;
  draftOrder: Array<{ userId: string; teamName: string; isBot: boolean }>;
};

export type DraftState = {
  draft: Draft;
  picks: DraftPick[];
  buyerCounts: CryptoBuyerCounts;
  turn: DraftTurn;
  summary: DraftSummary;
  leagueId: string;
  leagueOffBoard: string[];
  myStockSymbols: string[];
  liveDraft?: LiveDraftView | null;
  draftFeed?: DraftFeedEvent[];
  safetyPickSymbol?: string | null;
};

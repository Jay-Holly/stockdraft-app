import type { AwardKey } from "@/lib/awards/constants";

export type AwardPickMetric = {
  userId: string;
  pickId: string;
  pickType: "stock" | "bench" | "crypto";
  symbol: string;
  valueAtOpen: number;
  valueAtClose: number;
  stockValueAtFridayClose: number | null;
  weekDollarGain: number;
  weekGainPct: number;
};

export type AwardWinnerCandidate = {
  userId: string;
  pickId?: string;
  symbol?: string;
  score: number;
  detail: Record<string, unknown>;
};

export type ComputedAward = {
  awardKey: AwardKey;
  amountUsd: number;
  winner: AwardWinnerCandidate | null;
  noWinnerReason?: string;
};

export type LeagueBonusPoolRow = {
  league_id: string;
  season_base_total: number;
  regular_season_weeks: number;
  weekly_base_amount: number;
  draft_surcharge_total: number;
  rollover_balance: number;
  playoff_pool_balance: number;
  playoff_pool_seed_amount: number;
  regular_season_pool_total: number;
  playoff_allocation_status: "accumulating" | "allocated" | "paid_out";
  playoff_allocated_at: string | null;
  playoff_allocation_week: number | null;
};

export type PlayoffPoolLedgerRow = {
  id: string;
  league_id: string;
  week_number: number | null;
  event_type: "seed" | "weekly_rollover" | "allocation" | "payout";
  amount_usd: number;
  balance_after: number;
  detail_json: Record<string, unknown>;
  created_at: string;
};

export type PlayoffBonusAllocationRow = {
  id: string;
  league_id: string;
  allocation_week: number;
  total_pool_amount: number;
  seed_amount: number;
  rollover_amount: number;
  status: "pending_claims" | "complete";
  created_at: string;
};

export type PlayoffBonusPayoutRow = {
  id: string;
  allocation_id: string;
  league_id: string;
  user_id: string;
  seed_rank: number;
  share_pct: number;
  amount_usd: number;
  status: "pending" | "claimed" | "auto_claimed";
  target_pick_id: string | null;
  target_symbol: string | null;
  claimed_at: string | null;
  created_at: string;
};

export type PendingPlayoffPayout = PlayoffBonusPayoutRow & {
  allocation_week: number;
  total_pool_amount: number;
};

export type WeeklyAwardResultRow = {
  id: string;
  league_id: string;
  week_number: number;
  award_key: AwardKey;
  amount_usd: number;
  winner_user_id: string | null;
  qualifying_pick_id: string | null;
  qualifying_symbol: string | null;
  detail_json: Record<string, unknown>;
  no_winner_reason: string | null;
  computed_at: string;
};

export type WeeklyAwardPayoutRow = {
  id: string;
  award_result_id: string;
  league_id: string;
  user_id: string;
  amount_usd: number;
  status: "pending" | "claimed" | "auto_claimed" | "forfeited";
  target_pick_id: string | null;
  target_symbol: string | null;
  claimed_at: string | null;
  created_at: string;
};

export type PendingAwardPayout = WeeklyAwardPayoutRow & {
  award_key: AwardKey;
  award_label: string;
  award_emoji: string;
  week_number: number;
};

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

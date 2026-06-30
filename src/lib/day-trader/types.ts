import type { DayTraderContestStatus } from "@/lib/day-trader/constants";

export type DayTraderContestRow = {
  id: string;
  week_start_at: string;
  week_end_at: string;
  status: DayTraderContestStatus;
  contest_name: string;
  dollar_prize_text: string;
  percent_prize_text: string;
  created_at: string;
  updated_at: string;
};

export type DayTraderEntryRow = {
  id: string;
  contest_id: string;
  user_id: string;
  source_league_id: string | null;
  source_league_name: string | null;
  entered_at: string;
  starting_value: number;
  cash_balance: number;
  final_value: number | null;
  final_dollar_gain: number | null;
  final_pct_gain: number | null;
};

export type DayTraderPositionRow = {
  id: string;
  entry_id: string;
  symbol: string;
  shares: number;
  slot_order: number;
  source_pick_id: string | null;
  created_at: string;
};

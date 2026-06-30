import { SDPL_REGULAR_SEASON_WEEKS } from "@/lib/season/constants";

export const AWARD_SEASON_BASE_TOTAL = 100_000;
export const AWARD_REGULAR_SEASON_WEEKS = SDPL_REGULAR_SEASON_WEEKS;
export const AWARD_WEEKLY_BASE_AMOUNT =
  AWARD_SEASON_BASE_TOTAL / AWARD_REGULAR_SEASON_WEEKS;

export const AWARD_KEYS = [
  "winner_of_week",
  "rookie_of_week",
  "diamond_hands",
  "lottery_hit",
  "sweep_week",
  "loser_of_week",
  "bench_curse",
] as const;

export type AwardKey = (typeof AWARD_KEYS)[number];

export const AWARD_AMOUNTS: Record<AwardKey, number> = {
  winner_of_week: 2_000,
  rookie_of_week: 1_500,
  diamond_hands: 1_500,
  lottery_hit: 1_500,
  sweep_week: 1_500,
  loser_of_week: 832,
  bench_curse: 1,
};

export const AWARD_LABELS: Record<AwardKey, string> = {
  winner_of_week: "Winner of the Week",
  rookie_of_week: "Rookie of the Week",
  diamond_hands: "Diamond Hands",
  lottery_hit: "Lottery Hit",
  sweep_week: "Sweep Week",
  loser_of_week: "Loser of the Week",
  bench_curse: "Bench Curse",
};

export const AWARD_EMOJI: Record<AwardKey, string> = {
  winner_of_week: "🏆",
  rookie_of_week: "🌟",
  diamond_hands: "💎",
  lottery_hit: "🎰",
  sweep_week: "🔥",
  loser_of_week: "😢",
  bench_curse: "🪑",
};

export const AWARD_SLATE_TOTAL = Object.values(AWARD_AMOUNTS).reduce(
  (sum, amount) => sum + amount,
  0
);

export const LOTTERY_HIT_MIN_GAIN_PCT = 10;
export const SWEEP_STARTER_COUNT = 10;

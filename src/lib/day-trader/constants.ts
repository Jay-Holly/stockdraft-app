/** Total portfolio value at entry (10 × $50K). */
export const DAY_TRADER_STARTING_VALUE = 500_000;

/** Each starter stock is reset to this notional at entry. */
export const DAY_TRADER_STOCK_BUDGET = 50_000;

export const DAY_TRADER_MAX_POSITIONS = 10;

export const DAY_TRADER_CONTEST_STATUSES = [
  "upcoming",
  "open",
  "closed",
  "finalized",
] as const;

export type DayTraderContestStatus =
  (typeof DAY_TRADER_CONTEST_STATUSES)[number];

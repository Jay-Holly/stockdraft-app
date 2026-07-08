export type SimSport = "nfl" | "nba" | "nhl" | "mlb";

export const SPORTS_SIM_IR_SLOT_COUNT = 3;
export const IR_OPEN_SYMBOL = "__OPEN__";

export type IrEligibilityResult = {
  eligible: boolean;
  error?: string;
};

export type IrResolutionState = {
  required: boolean;
  picks: Array<{ pickId: string; symbol: string }>;
  message: string | null;
};

export type SimEligibilityContext =
  | { mode: "week"; weekNumber: number }
  | { mode: "date"; weekStart: string; weekEnd: string };

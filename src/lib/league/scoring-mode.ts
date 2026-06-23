import { formatPct, formatSignedMoney } from "@/lib/format";

export type LeagueScoringMode = "percent_gain" | "dollar_gain";

export const DEFAULT_LEAGUE_SCORING_MODE: LeagueScoringMode = "percent_gain";

export function parseLeagueScoringMode(value: unknown): LeagueScoringMode {
  return value === "dollar_gain" ? "dollar_gain" : "percent_gain";
}

export function scoringModeLabel(mode: LeagueScoringMode): string {
  return mode === "dollar_gain" ? "$ Gain Mode" : "% Gain Mode";
}

export function scoringModeShortLabel(mode: LeagueScoringMode): string {
  return mode === "dollar_gain" ? "Weekly $" : "Weekly %";
}

export function formatMatchupScore(
  value: number | null | undefined,
  mode: LeagueScoringMode
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return mode === "dollar_gain" ? formatSignedMoney(value) : formatPct(value);
}

export function matchupScoreEpsilon(mode: LeagueScoringMode): number {
  return mode === "dollar_gain" ? 0.01 : 0.0001;
}

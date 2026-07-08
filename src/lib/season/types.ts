export type SeasonFormat = "standard" | "beta_daily";

export type WeekCalendarEntry = {
  week: number;
  date: string;
};

export type LeagueFormatMeta = {
  formatType?: string | null;
  sportsLeagueId?: string | null;
  playerCount?: number | null;
};

export type SeasonSettingsRow = {
  season_format: SeasonFormat;
  regular_season_weeks: number;
  week_calendar: WeekCalendarEntry[] | null;
};

export type SeasonSettings = {
  /** When false (sports-sim / non-SDPL), lock and FA gates are not enforced. */
  rulesApply: boolean;
  seasonFormat: SeasonFormat;
  regularSeasonWeeks: number;
  weekCalendar: WeekCalendarEntry[] | null;
};

export type SeasonCalendarState = {
  rulesApply: boolean;
  seasonFormat: SeasonFormat;
  lineupLocked: boolean;
  freeAgencyOpen: boolean;
  nextLineupUnlockAt: string | null;
  nextLineupLockAt: string | null;
  nextFaOpenAt: string | null;
  nextFaCloseAt: string | null;
  lineupLockMessage: string | null;
  freeAgencyMessage: string | null;
};

export type SeasonCalendarErrorCode =
  | "LINEUP_LOCKED"
  | "FA_CLOSED"
  | "IR_RESOLUTION_REQUIRED";

export class SeasonCalendarError extends Error {
  readonly code: SeasonCalendarErrorCode;

  constructor(code: SeasonCalendarErrorCode, message: string) {
    super(message);
    this.name = "SeasonCalendarError";
    this.code = code;
  }
}

/** US Eastern — all season calendar boundaries use this zone. */
export const SEASON_TIMEZONE = "America/New_York";

/** Daily lineup lock: 9:30 AM ET (inclusive) through 4:00 PM ET (exclusive). */
export const LINEUP_LOCK_START_MINUTES = 9 * 60 + 30;
export const LINEUP_LOCK_END_MINUTES = 16 * 60;

/** Standard SDPL free agency: Saturday 9:30 AM ET → Monday 9:30 AM ET. */
export const FA_STANDARD_OPEN_MINUTES = LINEUP_LOCK_START_MINUTES;

/** Weekly matchup finalization (standard SDPL): Monday 6:00 AM ET. */
export const MATCHUP_FINALIZE_STANDARD_MINUTES = 6 * 60;

/** Permanent SDPL season structure: 11 regular + 2 playoff = 13 weeks (financial quarter). */
export const SDPL_REGULAR_SEASON_WEEKS = 11;
export const SDPL_PLAYOFF_WEEKS = 2;
export const SDPL_TOTAL_SEASON_WEEKS = 13;
export const SDPL_SEMIFINAL_WEEK = SDPL_REGULAR_SEASON_WEEKS + 1;
export const SDPL_FINALS_WEEK = SDPL_REGULAR_SEASON_WEEKS + 2;

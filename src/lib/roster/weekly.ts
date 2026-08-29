import "server-only";

/**
 * PLACEHOLDER — not a rebuild. See leaderboard.ts and portfolio-value.ts in
 * src/lib/day-trader/ for the full explanation: 31 files were deleted at
 * the start of the scoring-rebuild branch (2026-08-27), and this dev server
 * points at the live production database, not a sandbox.
 *
 * Every export below is synchronous even where the real function will be
 * async, on purpose: a sync throw propagates correctly whether or not a
 * caller awaits it; an async stub that a caller doesn't await would hand
 * back a Promise object instead of throwing, which is a worse, quieter
 * failure than the one this file exists to prevent.
 *
 * Two behaviors, chosen per export, never guessed at random:
 *   - A function whose job is to WRITE, COMPUTE a business number, or DECIDE
 *     an outcome throws immediately. Faking that value is how a $0.15 open
 *     scored a stock at +57,320% the first time. A loud error beats a quiet
 *     wrong number.
 *   - A function whose job is a plain READ (a quote, a list, a lookup) that
 *     found nothing returns an honestly empty result — the same shape a real
 *     "no rows" answer would have. That is not a fabrication; it is what an
 *     empty result actually looks like.
 *
 * Rebuild this against the real logic (and the new pricing module) before
 * relying on it for anything that touches money or a real score.
 */

function notImplemented(name) {
  return new Error(
    `${name}: not implemented — deleted in the scoring-rebuild branch cleanup ` +
    `(2026-08-27), not yet rebuilt. See SCORING_REBUILD_HANDOFF_2026-08-28.md.`
  );
}

export function adjustPickWeekBaseline(...args) {
  throw notImplemented("adjustPickWeekBaseline");
}

export function applyCryptoRebalanceWeekBaselines(...args) {
  throw notImplemented("applyCryptoRebalanceWeekBaselines");
}

export function applyIrMoveWeekBaselines(...args) {
  throw notImplemented("applyIrMoveWeekBaselines");
}

export function applyIrSwapWeekBaselines(...args) {
  throw notImplemented("applyIrSwapWeekBaselines");
}

export function captureFridayStockCloseForLeague(...args) {
  throw notImplemented("captureFridayStockCloseForLeague");
}

export function captureWeekBaselinesForLeague(...args) {
  throw notImplemented("captureWeekBaselinesForLeague");
}

export function captureWeekBaselinesForLeagueCarryingForward(...args) {
  throw notImplemented("captureWeekBaselinesForLeagueCarryingForward");
}

export function captureWeekCloseSnapshots(...args) {
  throw notImplemented("captureWeekCloseSnapshots");
}

export function computeScoringSeasonGainPercentForUser(...args) {
  throw notImplemented("computeScoringSeasonGainPercentForUser");
}

export function computeScoringWeekDollarGainForUser(...args) {
  throw notImplemented("computeScoringWeekDollarGainForUser");
}

export function computeScoringWeekGainPercent(...args) {
  throw notImplemented("computeScoringWeekGainPercent");
}

export function computeScoringWeekGainPercentForUser(...args) {
  throw notImplemented("computeScoringWeekGainPercentForUser");
}

export function computeWeekDollarGain(...args) {
  throw notImplemented("computeWeekDollarGain");
}

export function computeWeekGainPercent(...args) {
  throw notImplemented("computeWeekGainPercent");
}

export function ensureWeekBaselines(...args) {
  throw notImplemented("ensureWeekBaselines");
}

export function fillMissingWeekCloses(...args) {
  throw notImplemented("fillMissingWeekCloses");
}

export function getCurrentWeek(...args) {
  throw notImplemented("getCurrentWeek");
}

export function isTrustworthyBaselineValue(...args) {
  return false;
}

export function loadWeekBaselineExtendedMap(...args) {
  return {};
}

export function pickMarketValue(shares, price) {
  if (typeof shares !== "number" || typeof price !== "number") return 0;
  return shares * price;
}

export function setPickWeekBaseline(...args) {
  throw notImplemented("setPickWeekBaseline");
}

export function syncCryptoBaselinesAfterRebalance(...args) {
  throw notImplemented("syncCryptoBaselinesAfterRebalance");
}

export function weekMatchupLooksUncaptured(...args) {
  return false;
}


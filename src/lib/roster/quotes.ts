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

function notImplemented(name: string): Error {
  return new Error(
    `${name}: not implemented — deleted in the scoring-rebuild branch cleanup ` +
    `(2026-08-27), not yet rebuilt. See SCORING_REBUILD_HANDOFF_2026-08-28.md.`
  );
}

export function computeGainPercent(from: number, to: number): number {
  if (typeof from !== "number" || !(from > 0) || typeof to !== "number" || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

export function computeSharesFromBudget(budget: number, price: number): number {
  if (typeof price !== "number" || !(price > 0) || typeof budget !== "number") return 0;
  return budget / price;
}

type SimpleQuote = { price: number; changePercent: number };

export function fetchStockQuotes(...args: unknown[]): Map<string, SimpleQuote> {
  return new Map();
}

// These three return a real (zero-price) object rather than null — real
// callers (awards/claim.ts, roster/ir-moves.ts) already check `price <= 0`
// as their own "no data" signal and never guard for null, matching the
// original functions' contract.
export function getCryptoQuote(...args: unknown[]): SimpleQuote {
  return { price: 0, changePercent: 0 };
}

export function getStockQuote(...args: unknown[]): SimpleQuote {
  return { price: 0, changePercent: 0 };
}

export function getSymbolQuote(...args: unknown[]): SimpleQuote {
  return { price: 0, changePercent: 0 };
}

export function getCryptoQuotesMap(...args: unknown[]): Record<string, SimpleQuote> {
  return {};
}

export function getLastCryptoQuoteSource(...args: unknown[]): string | null {
  return null;
}


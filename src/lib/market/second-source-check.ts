import "server-only";

const YAHOO_TIMEOUT_MS = 6000;
const GROUP_SIZE = 5;

/**
 * How far a candidate price is allowed to differ from Yahoo's before it's
 * rejected as untrustworthy. Loose enough to tolerate normal cross-source
 * timing noise (a few seconds apart, different last-trade snapshots);
 * tight enough to catch what actually happened on Aug 11 — a stored ETH
 * close ~8% off the real price, a stored GOOGL open ~5% off.
 */
const CROSS_CHECK_TOLERANCE_PCT = 3;

/**
 * Live quote from Yahoo Finance's public (unofficial, unauthenticated)
 * chart endpoint. Covers both stocks (plain ticker) and crypto (ticker with
 * a "-USD" suffix, e.g. "ETH-USD") off the same endpoint. Used only as an
 * independent second opinion on a Finnhub/CoinGecko price, never as a
 * primary source — Yahoo being briefly unavailable should never block
 * scoring on its own.
 */
async function fetchYahooQuote(yahooTicker: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=1d&interval=1m`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && price > 0 ? price : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyPrices(
  candidatePrices: Record<string, number>,
  toYahooTicker: (symbol: string) => string
): Promise<Record<string, number>> {
  const symbols = Object.keys(candidatePrices).filter(
    (s) => candidatePrices[s] > 0
  );
  if (symbols.length === 0) return {};

  const verified: Record<string, number> = {};

  for (let i = 0; i < symbols.length; i += GROUP_SIZE) {
    const group = symbols.slice(i, i + GROUP_SIZE);
    const yahooPrices = await Promise.all(
      group.map((symbol) => fetchYahooQuote(toYahooTicker(symbol)))
    );

    group.forEach((symbol, idx) => {
      const candidate = candidatePrices[symbol];
      const yahoo = yahooPrices[idx];

      if (yahoo === null) {
        // Can't verify — trust the candidate rather than lose an
        // otherwise-good quote to an outage in the check itself.
        verified[symbol] = candidate;
        return;
      }

      const diffPct = (Math.abs(candidate - yahoo) / yahoo) * 100;
      if (diffPct <= CROSS_CHECK_TOLERANCE_PCT) {
        verified[symbol] = candidate;
      } else {
        console.error(
          `[second-source-check] ${symbol}: candidate=${candidate} vs Yahoo=${yahoo} (${diffPct.toFixed(1)}% apart) — rejecting, will retry`
        );
      }
    });
  }

  return verified;
}

/**
 * Cross-checks each candidate stock price against Yahoo Finance before
 * trusting it. A symbol whose price disagrees with Yahoo by more than the
 * tolerance is dropped from the result entirely — same as a failed fetch,
 * so it falls through to "no usable quote" rather than silently persisting
 * whichever source happened to be wrong.
 *
 * Only for lock/close — this is extra latency and API load that the
 * frequently-polled mid-week/mid-day preview doesn't need.
 */
export function verifyStockPrices(
  candidatePrices: Record<string, number>
): Promise<Record<string, number>> {
  return verifyPrices(candidatePrices, (symbol) => symbol);
}

/**
 * Same idea as verifyStockPrices, for crypto — Yahoo's chart endpoint
 * covers major coins under a "-USD" ticker (e.g. "ETH-USD").
 */
export function verifyCryptoPrices(
  candidatePrices: Record<string, number>
): Promise<Record<string, number>> {
  return verifyPrices(candidatePrices, (symbol) => `${symbol}-USD`);
}

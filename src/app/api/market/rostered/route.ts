import { NextResponse } from "next/server";

import { getPlatformRosteredSymbols } from "@/lib/league/server";
import { getLatestPrices } from "@/lib/pricing/read";

export const dynamic = "force-dynamic";

/**
 * Live prices for every symbol currently rostered anywhere on the platform.
 *
 * Reads the price log. This route used to assemble an answer from a cached
 * quote table plus a hardcoded fallback list, which meant a symbol the cache
 * had never heard of could still come back with a number from a static file
 * committed months earlier. A price nobody observed is not a price.
 *
 * A symbol the log has no usable price for is simply omitted. The client
 * renders a symbol with no quote as "no price," which is the honest state.
 */
export async function GET() {
  const symbols = await getPlatformRosteredSymbols();
  if (symbols.length === 0) {
    return NextResponse.json({ symbols: [], quotes: {} });
  }

  const lookup = await getLatestPrices(symbols);
  const quotes: Record<
    string,
    { price: number; prevClose: number; changePercent: number }
  > = {};

  for (const [symbol, hit] of lookup.hits) {
    const changePercent = hit.changePercent ?? 0;
    // The client wants a previous close to render a change from. Derive it
    // from the provider's own change percent rather than inventing one: if
    // the provider gave no change, prevClose equals the price and the change
    // shows as flat, which is the truthful "we don't know" rendering.
    const prevClose =
      changePercent !== 0 ? hit.price / (1 + changePercent / 100) : hit.price;

    quotes[symbol] = { price: hit.price, prevClose, changePercent };
  }

  if (lookup.misses.size > 0) {
    console.warn(
      `[api/market/rostered] no usable price for ${lookup.misses.size} of ${symbols.length} rostered symbols`
    );
  }

  return NextResponse.json({ symbols, quotes });
}

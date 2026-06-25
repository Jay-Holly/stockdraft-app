import { NextResponse } from "next/server";
import {
  fetchFinnhubQuotes,
  searchFinnhubSymbols,
} from "@/lib/finnhub/service";
import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";
import { upsertStockPriceCache } from "@/lib/market/upsert-stock-prices";

export const dynamic = "force-dynamic";

const SEARCH_ROUTE_TIMEOUT_MS = 8000;
const MAX_QUOTED_RESULTS = 8;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";

  if (query.length < 1) {
    return NextResponse.json({ results: [] });
  }

  try {
    const payload = await Promise.race([
      buildSearchResults(query),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Search timed out")),
          SEARCH_ROUTE_TIMEOUT_MS
        );
      }),
    ]);

    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/market/search failed:", err);
    return NextResponse.json(
      {
        results: [],
        error: "Search timed out — try a shorter or exact ticker.",
      },
      { status: 504 }
    );
  }
}

async function buildSearchResults(query: string) {
  const search = await searchFinnhubSymbols(query);
  if (!search.ok) {
    return {
      results: [],
      error: search.error,
      finnhubStatus: search.status ?? null,
    };
  }

  const topMatches = search.results.slice(0, MAX_QUOTED_RESULTS);
  if (topMatches.length === 0) {
    return { results: [] as const };
  }

  const quoteMap = await fetchFinnhubQuotes(
    topMatches.map((match) => match.symbol),
    { cache: "no-store" }
  );

  const cacheRows: Array<{
    symbol: string;
    price: number;
    changePercent: number;
  }> = [];

  const quoted = topMatches
    .map((match) => {
      const quote = quoteMap[match.symbol];
      if (!quote || quote.price < MIN_STOCK_PRICE_USD) return null;

      cacheRows.push({
        symbol: match.symbol,
        price: quote.price,
        changePercent: quote.changePercent,
      });

      return {
        symbol: match.symbol,
        name: match.description,
        price: quote.price,
        changePercent: quote.changePercent,
        mic: match.mic ?? null,
      };
    })
    .filter(Boolean);

  if (cacheRows.length > 0) {
    await upsertStockPriceCache(cacheRows);
  }

  if (quoted.length === 0 && topMatches.length > 0) {
    return {
      results: [],
      error: `Symbols matched but none trade at $${MIN_STOCK_PRICE_USD}+ right now.`,
    };
  }

  return { results: quoted };
}

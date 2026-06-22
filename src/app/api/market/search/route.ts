import { NextResponse } from "next/server";
import { searchFinnhubSymbols, fetchFinnhubQuote } from "@/lib/finnhub/service";
import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";

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
    const results = await Promise.race([
      buildSearchResults(query),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Search timed out")),
          SEARCH_ROUTE_TIMEOUT_MS
        );
      }),
    ]);

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { results: [], error: "Search timed out — try a shorter or exact ticker." },
      { status: 504 }
    );
  }
}

async function buildSearchResults(query: string) {
  const matches = await searchFinnhubSymbols(query);
  const topMatches = matches.slice(0, MAX_QUOTED_RESULTS);

  const quoted = await Promise.all(
    topMatches.map(async (match) => {
      const quote = await fetchFinnhubQuote(match.symbol);
      if (!quote || quote.price < MIN_STOCK_PRICE_USD) return null;

      return {
        symbol: match.symbol,
        name: match.description,
        price: quote.price,
        changePercent: quote.changePercent,
        mic: match.mic ?? null,
      };
    })
  );

  return quoted.filter(Boolean);
}

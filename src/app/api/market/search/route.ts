import { NextResponse } from "next/server";
import { searchFinnhubSymbols, fetchFinnhubQuote } from "@/lib/finnhub/service";
import { MIN_STOCK_PRICE_USD } from "@/lib/market/draft-pool";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";

  if (query.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const matches = await searchFinnhubSymbols(query);
  const results = [];

  for (const match of matches) {
    const quote = await fetchFinnhubQuote(match.symbol);
    if (!quote || quote.price < MIN_STOCK_PRICE_USD) continue;

    results.push({
      symbol: match.symbol,
      name: match.description,
      price: quote.price,
      changePercent: quote.changePercent,
      mic: match.mic ?? null,
    });
  }

  return NextResponse.json({ results });
}

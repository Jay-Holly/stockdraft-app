import { NextResponse } from "next/server";
import {
  fetchCachedStockQuotes,
  toApiQuote,
} from "@/lib/market/cached-prices";
import { mergeQuotesWithFallback } from "@/lib/market/fallback-quotes";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");

  if (!symbolsParam) {
    return NextResponse.json(
      { error: "Provide symbols query param, e.g. ?symbols=AAPL,MSFT" },
      { status: 400 }
    );
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 100);

  if (symbols.length === 0) {
    return NextResponse.json({});
  }

  const cached = await fetchCachedStockQuotes(symbols);
  const live = Object.fromEntries(
    Object.entries(cached).map(([symbol, quote]) => [symbol, toApiQuote(quote)])
  );

  const quotes = mergeQuotesWithFallback(symbols, live);
  return NextResponse.json(quotes);
}

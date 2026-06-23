import { NextResponse } from "next/server";
import { getPlatformRosteredSymbols } from "@/lib/league/server";
import {
  fetchCachedStockQuotes,
  toApiQuote,
} from "@/lib/market/cached-prices";
import { mergeQuotesWithFallback } from "@/lib/market/fallback-quotes";

export async function GET() {
  const symbols = await getPlatformRosteredSymbols();
  const cached = await fetchCachedStockQuotes(symbols);
  const live = Object.fromEntries(
    Object.entries(cached).map(([symbol, quote]) => [symbol, toApiQuote(quote)])
  );
  const quotes = mergeQuotesWithFallback(symbols, live);

  return NextResponse.json({ symbols, quotes });
}

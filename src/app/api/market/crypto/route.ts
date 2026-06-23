import { NextResponse } from "next/server";
import {
  fetchAllCachedCryptoQuotes,
  fetchCachedCryptoQuotes,
  toApiQuote,
} from "@/lib/market/cached-prices";
import { fetchCryptoPool, getCachedCryptoPool } from "@/lib/crypto-pool/server";

function referenceQuotesFromPool(): Record<
  string,
  { price: number; changePercent: number }
> {
  const quotes: Record<string, { price: number; changePercent: number }> = {};
  for (const coin of getCachedCryptoPool()) {
    if (coin.referencePriceUsd != null && coin.referencePriceUsd > 0) {
      quotes[coin.symbol] = {
        price: coin.referencePriceUsd,
        changePercent: 0,
      };
    }
  }
  return quotes;
}

export async function GET(request: Request) {
  await fetchCryptoPool();

  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  const requested = symbolsParam
    ? symbolsParam
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
    : null;

  const cached = requested
    ? await fetchCachedCryptoQuotes(requested)
    : await fetchAllCachedCryptoQuotes();

  const response: Record<
    string,
    { price: number; changePercent: number; updatedAt?: string | null }
  > = {};

  const symbols =
    requested ??
    (getCachedCryptoPool().length > 0
      ? getCachedCryptoPool().map((coin) => coin.symbol)
      : Object.keys(cached));

  const fallback = referenceQuotesFromPool();

  for (const symbol of symbols) {
    const quote = cached[symbol];
    if (quote?.price) {
      const apiQuote = toApiQuote(quote);
      response[symbol] = {
        price: apiQuote.price,
        changePercent: apiQuote.changePercent,
        updatedAt: apiQuote.updatedAt,
      };
      continue;
    }

    const ref = fallback[symbol];
    if (ref) {
      response[symbol] = ref;
    }
  }

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      "X-Crypto-Quote-Source": "cache",
    },
  });
}

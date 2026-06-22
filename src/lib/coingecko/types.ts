export type CryptoQuote = {
  price: number;
  changePercent: number;
};

export type CryptoQuoteSource = "live" | "cache" | "fallback";

export type CryptoQuotesResult = {
  quotes: Record<string, CryptoQuote>;
  source: CryptoQuoteSource;
  fetchedAt: number | null;
};

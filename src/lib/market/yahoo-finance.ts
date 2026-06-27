import { isCryptoSymbol } from "@/lib/draft/engine";

export function getYahooFinanceQuoteUrl(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  const yahooSymbol = isCryptoSymbol(upper) ? `${upper}-USD` : upper;
  return `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol)}/`;
}

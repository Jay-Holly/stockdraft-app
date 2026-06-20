import {
  CRYPTO_COINGECKO_IDS,
  CRYPTO_SYMBOLS,
  type CryptoSymbol,
} from "@/lib/market/symbols";

type CoinGeckoPriceResponse = Record<
  string,
  { usd?: number; usd_24h_change?: number }
>;

export type CryptoQuote = {
  price: number;
  changePercent: number;
};

export async function fetchCryptoQuotes(): Promise<
  Record<CryptoSymbol, CryptoQuote>
> {
  const ids = Object.values(CRYPTO_COINGECKO_IDS).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch crypto prices");
  }

  const data = (await response.json()) as CoinGeckoPriceResponse;
  const quotes = {} as Record<CryptoSymbol, CryptoQuote>;

  for (const symbol of CRYPTO_SYMBOLS) {
    const id = CRYPTO_COINGECKO_IDS[symbol];
    const entry = data[id];
    quotes[symbol] = {
      price: entry?.usd ?? 0,
      changePercent: entry?.usd_24h_change ?? 0,
    };
  }

  return quotes;
}

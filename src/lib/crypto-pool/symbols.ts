/** Legacy fallback until Supabase crypto_pool is loaded. */
const LEGACY_CRYPTO_SYMBOLS = ["BTC", "ETH", "SOL", "DOGE"] as const;

let cryptoSymbolSet = new Set<string>(LEGACY_CRYPTO_SYMBOLS);
let coingeckoIdBySymbol = new Map<string, string>([
  ["BTC", "bitcoin"],
  ["ETH", "ethereum"],
  ["SOL", "solana"],
  ["DOGE", "dogecoin"],
]);

export function setCryptoPoolCache(
  coins: Array<{ symbol: string; coingeckoId: string }>
): void {
  if (coins.length === 0) return;

  cryptoSymbolSet = new Set(coins.map((coin) => coin.symbol.toUpperCase()));
  coingeckoIdBySymbol = new Map(
    coins.map((coin) => [coin.symbol.toUpperCase(), coin.coingeckoId])
  );
}

export function getCryptoSymbols(): string[] {
  return [...cryptoSymbolSet].sort();
}

export function getCoingeckoIdForSymbol(symbol: string): string | null {
  return coingeckoIdBySymbol.get(symbol.toUpperCase()) ?? null;
}

export function getCoingeckoIdMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [symbol, id] of coingeckoIdBySymbol.entries()) {
    map[symbol] = id;
  }
  return map;
}

export function isCryptoPoolSymbol(symbol: string): boolean {
  return cryptoSymbolSet.has(symbol.toUpperCase());
}

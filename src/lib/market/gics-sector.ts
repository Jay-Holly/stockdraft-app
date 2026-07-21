import sectorData from "@/data/sp500-gics-sectors.json";
import { isCryptoPoolSymbol } from "@/lib/crypto-pool/symbols";

/** Real GICS sectors for the full 503-stock draft pool (src/data/sp500-gics-sectors.json). */
export type GicsSector =
  | "Communication Services"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Energy"
  | "Financials"
  | "Health Care"
  | "Industrials"
  | "Information Technology"
  | "Materials"
  | "Real Estate"
  | "Utilities"
  | "Crypto";

const SECTORS: Record<string, string> = sectorData.sectors;

/**
 * Real sector for a stock (GICS) or "Crypto" for any crypto symbol.
 * Returns null only for a symbol that is neither a known S&P 500 stock nor
 * a recognized crypto symbol (should not happen for anything actually
 * rostered, since both pools are closed sets).
 */
export function getSectorForSymbol(symbol: string): GicsSector | null {
  const upper = symbol.toUpperCase();
  if (upper in SECTORS) {
    return SECTORS[upper] as GicsSector;
  }
  if (isCryptoPoolSymbol(upper)) {
    return "Crypto";
  }
  return null;
}

import { isCryptoPoolSymbol } from "@/lib/crypto-pool/symbols";
import { STOCK_SYMBOLS } from "@/lib/market/symbols";

export type AssetSector =
  | "Tech"
  | "AI"
  | "Crypto"
  | "EV"
  | "Space"
  | "Media";

export const STOCK_META: Record<
  (typeof STOCK_SYMBOLS)[number],
  { name: string; sector: AssetSector }
> = {
  NVDA: { name: "NVIDIA", sector: "AI" },
  AAPL: { name: "Apple", sector: "Tech" },
  MSFT: { name: "Microsoft", sector: "Tech" },
  TSLA: { name: "Tesla", sector: "EV" },
  GOOGL: { name: "Alphabet", sector: "Tech" },
  AMZN: { name: "Amazon", sector: "Tech" },
  META: { name: "Meta Platforms", sector: "Tech" },
  NFLX: { name: "Netflix", sector: "Media" },
  AMD: { name: "Advanced Micro Devices", sector: "Tech" },
  INTC: { name: "Intel", sector: "Tech" },
  PLTR: { name: "Palantir", sector: "AI" },
  SOFI: { name: "SoFi Technologies", sector: "Tech" },
  SPCX: { name: "SpaceX (proxy)", sector: "Space" },
  FAC: { name: "Factorial Energy", sector: "EV" },
  QS: { name: "QuantumScape", sector: "EV" },
  SLDP: { name: "Solid Power", sector: "EV" },
  SES: { name: "SES AI", sector: "EV" },
  IONQ: { name: "IonQ", sector: "AI" },
  COIN: { name: "Coinbase", sector: "Crypto" },
  DIS: { name: "Disney", sector: "Media" },
};

export const CRYPTO_META: Record<string, { name: string; sector: "Crypto" }> = {
  BTC: { name: "Bitcoin", sector: "Crypto" },
  ETH: { name: "Ethereum", sector: "Crypto" },
  SOL: { name: "Solana", sector: "Crypto" },
  DOGE: { name: "Dogecoin", sector: "Crypto" },
};

export function getAssetMeta(symbol: string) {
  if (symbol in STOCK_META) {
    return STOCK_META[symbol as keyof typeof STOCK_META];
  }
  if (symbol in CRYPTO_META) {
    return CRYPTO_META[symbol];
  }
  if (isCryptoPoolSymbol(symbol)) {
    return { name: symbol, sector: "Crypto" as const };
  }
  return { name: symbol, sector: "Tech" as AssetSector };
}

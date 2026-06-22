export const CRYPTO_POOL_TARGET_SIZE = 50;

/** Symbols excluded from the draft pool (stablecoins, gold-pegged, wrapped duplicates). */
export const EXCLUDED_CRYPTO_SYMBOLS = new Set([
  "USDT",
  "USDC",
  "DAI",
  "BUSD",
  "TUSD",
  "USDP",
  "USDD",
  "FDUSD",
  "PYUSD",
  "FRAX",
  "LUSD",
  "GUSD",
  "SUSD",
  "USDE",
  "USD0",
  "USDS",
  "USDL",
  "USDY",
  "EURC",
  "EURT",
  "PAXG",
  "XAUT",
  "XAUt",
  "TGBP",
  "AUSD",
  "CUSD",
  "USDB",
  "USDT0",
  "USDX",
  "UST",
  "USTC",
  "MIM",
  "CRVUSD",
  "GHO",
  "MKUSD",
  "USTB",
  "OUSG",
  "BCAP",
  "FIUSD",
  "PGOLD",
  "XAUM",
  "TSLAX",
  "USDF",
  "BFUSD",
  "USD1",
  "USYC",
  "BUIDL",
  "FIGR_HELOC",
  // Wrapped / liquid-staking duplicates of assets kept in native form
  "WBTC",
  "WETH",
  "STETH",
  "WSTETH",
  "CBETH",
  "RETH",
  "WBETH",
  "WEETH",
  "BETH",
  "METH",
  "WBNB",
  "WSOL",
]);

/** CoinGecko IDs excluded even if the symbol differs. */
export const EXCLUDED_COINGECKO_IDS = new Set([
  "tether",
  "usd-coin",
  "dai",
  "binance-usd",
  "true-usd",
  "pax-gold",
  "tether-gold",
  "paypal-usd",
  "first-digital-usd",
  "ripple-usd",
  "usdd",
  "frax",
  "liquity-usd",
  "gemini-dollar",
  "stasis-eurs",
  "euro-coin",
  "tether-eurt",
  "global-dollar",
  "usds",
  "usdb",
  "usde",
  "usd0-liquid-bond",
  "mountain-protocol-usdm",
  "crvusd",
  "gho",
  "magic-internet-money",
  "terrausd",
  "terrausd-wormhole",
  "ondo-us-dollar-yield",
  "ousg",
  "superstate-uscc",
  "superstate-short-duration-us-government-securities-fund-ustb",
  "blockchain-capital",
  "kinesis-gold",
  "kinesis-silver",
  // Wrapped / staked duplicates
  "wrapped-bitcoin",
  "weth",
  "staked-ether",
  "lido-staked-ether",
  "wrapped-steth",
  "coinbase-wrapped-staked-eth",
  "rocket-pool-eth",
  "mantle-staked-ether",
  "wrapped-beacon-eth",
  "wrapped-eeth",
  "binance-eth",
  "wrapped-solana",
  "wrapped-bnb-wormhole",
  "blackrock-usd-institutional-digital-liquidity-fund",
  "figure-heloc",
  "usd1-wormhole",
  "usdf",
  "bfusd",
]);

const EXCLUDED_NAME_PATTERNS = [
  /pax gold/i,
  /tether gold/i,
  /gold token/i,
  /gold-pegged/i,
  /wrapped gold/i,
  /treasury/i,
  /t-bill/i,
  /government securities/i,
  /money market/i,
  /tokenized stock/i,
  /tokenized equity/i,
  /ondo /i,
  /superstate/i,
  /^wrapped /i,
  / liquid staking/i,
  / staked ether/i,
];

export function isExcludedCryptoAsset(input: {
  symbol: string;
  name: string;
  coingeckoId: string;
}): boolean {
  const symbol = input.symbol.toUpperCase();
  const id = input.coingeckoId.toLowerCase();
  const name = input.name.toLowerCase();

  if (EXCLUDED_CRYPTO_SYMBOLS.has(symbol)) return true;
  if (EXCLUDED_COINGECKO_IDS.has(id)) return true;

  if (EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }

  if (/\b(stablecoin|pegged usd|usd stable)\b/i.test(name)) {
    return true;
  }

  return false;
}

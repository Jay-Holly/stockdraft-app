import { NextResponse } from "next/server";
import { CRYPTO_LIVE_CACHE_TTL_MS } from "@/lib/coingecko/constants";
import { fetchCryptoQuotesWithMeta } from "@/lib/coingecko/service";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";

export async function GET() {
  await fetchCryptoPool();
  const { quotes, source } = await fetchCryptoQuotesWithMeta();
  const cacheSeconds = Math.ceil(CRYPTO_LIVE_CACHE_TTL_MS / 1000);

  return NextResponse.json(quotes, {
    headers: {
      "Cache-Control": `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`,
      "X-Crypto-Quote-Source": source,
    },
  });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { listPendingAwardPayouts } from "@/lib/awards/claim";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [pending, cryptoPool] = await Promise.all([
      listPendingAwardPayouts(user.id),
      fetchCryptoPool(),
    ]);

    return NextResponse.json({
      pending,
      cryptoOptions: cryptoPool.map((coin) => ({
        symbol: coin.symbol,
        name: coin.name,
      })),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load pending awards.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

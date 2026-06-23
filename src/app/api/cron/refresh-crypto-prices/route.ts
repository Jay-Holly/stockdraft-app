import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { refreshCryptoPricesFromCoingecko } from "@/lib/market/refresh-crypto-prices";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshCryptoPricesFromCoingecko();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Crypto price refresh failed:", error);
    return NextResponse.json(
      { error: "Crypto price refresh failed" },
      { status: 500 }
    );
  }
}

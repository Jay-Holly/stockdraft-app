import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { refreshStockPricesFromFinnhub } from "@/lib/market/refresh-stock-prices";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshStockPricesFromFinnhub();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Stock price refresh failed:", error);
    return NextResponse.json(
      { error: "Stock price refresh failed" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { fetchStockDetail } from "@/lib/finnhub/stock-detail";
import { isCryptoSymbol } from "@/lib/draft/engine";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z.\-]{1,8}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";

  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
  }

  if (isCryptoSymbol(symbol)) {
    return NextResponse.json(
      { error: "Stock detail is not available for crypto symbols." },
      { status: 400 }
    );
  }

  if (!process.env.NEXT_PUBLIC_FINNHUB_KEY) {
    return NextResponse.json(
      { error: "Market data is temporarily unavailable." },
      { status: 503 }
    );
  }

  try {
    const detail = await fetchStockDetail(symbol);

    if (!detail.profile && !detail.metrics && !detail.candles) {
      return NextResponse.json(
        { error: "No detail data found for this symbol." },
        { status: 404 }
      );
    }

    return NextResponse.json(detail);
  } catch (err) {
    console.error("GET /api/market/stock-detail failed:", err);
    return NextResponse.json(
      { error: "Could not load stock detail — try again." },
      { status: 500 }
    );
  }
}

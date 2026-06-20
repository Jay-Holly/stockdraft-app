import { NextResponse } from "next/server";
import { fetchFinnhubQuotes } from "@/lib/finnhub/service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");

  if (!symbolsParam) {
    return NextResponse.json(
      { error: "Provide symbols query param, e.g. ?symbols=AAPL,MSFT" },
      { status: 400 }
    );
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);

  if (symbols.length === 0) {
    return NextResponse.json({});
  }

  const quotes = await fetchFinnhubQuotes(symbols);
  return NextResponse.json(quotes);
}

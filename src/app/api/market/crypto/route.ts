import { NextResponse } from "next/server";
import { fetchCryptoQuotes } from "@/lib/coingecko/service";

export async function GET() {
  try {
    const quotes = await fetchCryptoQuotes();
    return NextResponse.json(quotes);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch crypto prices" },
      { status: 502 }
    );
  }
}

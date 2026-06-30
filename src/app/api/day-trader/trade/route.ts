import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import {
  executeDayTraderBuy,
  executeDayTraderSell,
} from "@/lib/day-trader/trade";

export const dynamic = "force-dynamic";

type TradeBody = {
  side?: "buy" | "sell";
  symbol?: string;
  notional?: number;
  shares?: number | null;
};

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as TradeBody;
    const side = body.side;
    const symbol = body.symbol?.trim();

    if (!side || (side !== "buy" && side !== "sell")) {
      return NextResponse.json(
        { error: "side must be buy or sell." },
        { status: 400 }
      );
    }

    if (!symbol) {
      return NextResponse.json({ error: "symbol is required." }, { status: 400 });
    }

    const result =
      side === "buy"
        ? await executeDayTraderBuy(user.id, symbol, Number(body.notional))
        : await executeDayTraderSell(
            user.id,
            symbol,
            body.shares == null ? null : Number(body.shares)
          );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ portfolio: result.portfolio });
  } catch (error) {
    console.error("Day Trader trade error:", error);
    return NextResponse.json(
      { error: "Trade could not be completed." },
      { status: 500 }
    );
  }
}

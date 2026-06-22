import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyCryptoRebalance } from "@/lib/roster/moves";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const started = Date.now();

  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      pickId?: string;
      newSymbol?: string;
      sellPercent?: number;
    };

    if (!body.pickId || !body.newSymbol) {
      return NextResponse.json(
        { error: "pickId and newSymbol are required." },
        { status: 400 }
      );
    }

    const sellPercent =
      body.sellPercent === undefined ? 100 : Number(body.sellPercent);

    const result = await applyCryptoRebalance(
      user.id,
      body.pickId,
      body.newSymbol,
      sellPercent
    );

    const elapsedMs = Date.now() - started;

    if (result.error) {
      return NextResponse.json(
        { error: result.error, step: "applyCryptoRebalance", elapsedMs },
        { status: 400, headers: { "X-Roster-Move-Ms": String(elapsedMs) } }
      );
    }

    return NextResponse.json(
      { success: true, elapsedMs },
      { headers: { "X-Roster-Move-Ms": String(elapsedMs) } }
    );
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const message =
      err instanceof Error ? err.message : "Crypto rebalance failed unexpectedly";
    console.error("Crypto swap route error:", err);
    return NextResponse.json(
      { error: message, step: "crypto-swap-route", elapsedMs },
      { status: 500, headers: { "X-Roster-Move-Ms": String(elapsedMs) } }
    );
  }
}

import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyCryptoRebalance } from "@/lib/roster/moves";

export async function POST(request: Request) {
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
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

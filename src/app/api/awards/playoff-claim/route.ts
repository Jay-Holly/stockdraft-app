import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { claimPlayoffPayout } from "@/lib/awards/claim";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      payoutId?: string;
      targetPickId?: string;
    };

    if (!body.payoutId || !body.targetPickId) {
      return NextResponse.json(
        { error: "payoutId and targetPickId are required." },
        { status: 400 }
      );
    }

    const result = await claimPlayoffPayout(
      user.id,
      body.payoutId,
      body.targetPickId
    );

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      symbol: result.symbol,
      amountUsd: result.amountUsd,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not claim playoff bonus.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

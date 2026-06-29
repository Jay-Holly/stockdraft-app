import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyIrSwap } from "@/lib/roster/moves";
import { rosterMoveHttpStatus } from "@/lib/season/move-gates";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const started = Date.now();

  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      starterPickId?: string;
      benchPickId?: string;
    };

    if (!body.starterPickId || !body.benchPickId) {
      return NextResponse.json(
        { error: "starterPickId and benchPickId are required." },
        { status: 400 }
      );
    }

    const result = await applyIrSwap(
      user.id,
      body.starterPickId,
      body.benchPickId
    );

    const elapsedMs = Date.now() - started;

    if (result.error) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          step: "applyIrSwap",
          elapsedMs,
        },
        {
          status: rosterMoveHttpStatus(result),
          headers: { "X-Roster-Move-Ms": String(elapsedMs) },
        }
      );
    }

    return NextResponse.json(
      { success: true, elapsedMs },
      { headers: { "X-Roster-Move-Ms": String(elapsedMs) } }
    );
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const message =
      err instanceof Error ? err.message : "IR swap failed unexpectedly";
    console.error("IR swap route error:", err);
    return NextResponse.json(
      { error: message, step: "ir-swap-route", elapsedMs },
      { status: 500, headers: { "X-Roster-Move-Ms": String(elapsedMs) } }
    );
  }
}

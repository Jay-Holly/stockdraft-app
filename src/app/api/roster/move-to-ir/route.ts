import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyMoveToIr } from "@/lib/roster/ir-moves";
import { rosterMoveHttpStatus } from "@/lib/season/move-gates";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      starterPickId?: string;
      irSlotPickId?: string;
    };

    if (!body.starterPickId || !body.irSlotPickId) {
      return NextResponse.json(
        { error: "starterPickId and irSlotPickId are required." },
        { status: 400 }
      );
    }

    const result = await applyMoveToIr(
      user.id,
      body.starterPickId,
      body.irSlotPickId
    );

    if (result.error) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: rosterMoveHttpStatus(result) }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Move to IR failed unexpectedly";
    console.error("move-to-ir route error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

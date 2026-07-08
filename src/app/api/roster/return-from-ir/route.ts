import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyReturnFromIr } from "@/lib/roster/ir-moves";
import { rosterMoveHttpStatus } from "@/lib/season/move-gates";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      irPickId?: string;
      openStockPickId?: string;
    };

    if (!body.irPickId) {
      return NextResponse.json(
        { error: "irPickId is required." },
        { status: 400 }
      );
    }

    const result = await applyReturnFromIr(
      user.id,
      body.irPickId,
      body.openStockPickId
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
      err instanceof Error ? err.message : "Return from IR failed unexpectedly";
    console.error("return-from-ir route error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

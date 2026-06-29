import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyWaiverClaim } from "@/lib/roster/moves";
import { loadFreeAgentsPageData } from "@/lib/roster/server";
import { rosterMoveHttpStatus } from "@/lib/season/move-gates";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      droppedPickId?: string;
      symbol?: string;
    };

    if (!body.droppedPickId || !body.symbol) {
      return NextResponse.json(
        { error: "droppedPickId and symbol are required." },
        { status: 400 }
      );
    }

    const result = await applyWaiverClaim(
      user.id,
      body.droppedPickId,
      body.symbol
    );
    if (result.error) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: rosterMoveHttpStatus(result) }
      );
    }

    const data = await loadFreeAgentsPageData(user.id);
    if (!data.ok) {
      return NextResponse.json({ error: data.error }, { status: 500 });
    }

    return NextResponse.json(data.data);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Waiver claim failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

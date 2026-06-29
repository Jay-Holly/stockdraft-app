import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { applyBenchDrop } from "@/lib/roster/moves";
import { loadFreeAgentsPageData } from "@/lib/roster/server";
import { rosterMoveHttpStatus } from "@/lib/season/move-gates";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { benchPickId?: string };
    if (!body.benchPickId) {
      return NextResponse.json(
        { error: "benchPickId is required." },
        { status: 400 }
      );
    }

    const result = await applyBenchDrop(user.id, body.benchPickId);
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

    return NextResponse.json({
      ...data.data,
      releasedSymbol: result.releasedSymbol,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Bench drop failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

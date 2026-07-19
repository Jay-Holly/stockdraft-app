import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { loadMyTeamPageData } from "@/lib/roster/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();

  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week");
    const weekNumber = weekParam ? Number(weekParam) : undefined;

    const result = await loadMyTeamPageData(user.id, {
      weekNumber: Number.isFinite(weekNumber) ? weekNumber : undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const elapsedMs = Date.now() - started;

    return NextResponse.json(result.data, {
      headers: { "X-Roster-Load-Ms": String(elapsedMs) },
    });
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const message =
      err instanceof Error ? err.message : "Could not load roster";
    console.error("Roster GET error:", err);
    return NextResponse.json(
      { error: message, elapsedMs },
      { status: 500, headers: { "X-Roster-Load-Ms": String(elapsedMs) } }
    );
  }
}

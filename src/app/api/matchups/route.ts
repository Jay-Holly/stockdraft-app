import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { loadMatchupsPageData } from "@/lib/matchup/page-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week");
    const weekNumber = weekParam ? Number(weekParam) : undefined;
    const viewWeek = Number.isFinite(weekNumber) ? weekNumber : undefined;

    const result = await loadMatchupsPageData(user.id, { weekNumber: viewWeek });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "";
    console.error("GET /api/matchups failed:", { errorMsg, stack });
    return NextResponse.json(
      {
        error: errorMsg || "Internal server error loading matchups.",
        details: process.env.NODE_ENV === "development" ? stack : undefined,
      },
      { status: 500 }
    );
  }
}

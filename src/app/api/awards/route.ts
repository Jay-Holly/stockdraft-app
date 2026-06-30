import { NextResponse } from "next/server";
import { loadAwardsPageData } from "@/lib/awards/page-data";
import { getAuthenticatedUserId } from "@/lib/draft/server";

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

    const result = await loadAwardsPageData(user.id, { weekNumber: viewWeek });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error("GET /api/awards failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error loading awards.",
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { createDayTraderEntry } from "@/lib/day-trader/entry";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { leagueId?: string };
    const leagueId = body.leagueId?.trim();
    if (!leagueId) {
      return NextResponse.json(
        { error: "Choose a league to copy your starters from." },
        { status: 400 }
      );
    }

    const result = await createDayTraderEntry(user.id, leagueId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ entry: result.entry });
  } catch (error) {
    console.error("Day Trader enter error:", error);
    return NextResponse.json(
      { error: "Could not enter Day Trader contest." },
      { status: 500 }
    );
  }
}

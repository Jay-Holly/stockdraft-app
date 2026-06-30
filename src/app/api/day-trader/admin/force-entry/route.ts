import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { forceDayTraderAdminEntry } from "@/lib/day-trader/admin-force-entry";
import { loadDayTraderPortfolio } from "@/lib/day-trader/portfolio";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      supportCode?: string;
      leagueId?: string;
      userId?: string;
      contestId?: string;
    };

    const result = await forceDayTraderAdminEntry(user.id, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const portfolio = await loadDayTraderPortfolio(result.entry);

    return NextResponse.json({
      ok: true,
      entry: result.entry,
      portfolio,
      bypassedEntryWindow: true,
    });
  } catch (error) {
    console.error("Day Trader admin force-entry error:", error);
    return NextResponse.json(
      { error: "Could not force Day Trader entry." },
      { status: 500 }
    );
  }
}

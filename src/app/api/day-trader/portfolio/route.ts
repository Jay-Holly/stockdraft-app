import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { getDayTraderContestContext } from "@/lib/day-trader/contest-access";
import { loadDayTraderPortfolio } from "@/lib/day-trader/portfolio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const context = await getDayTraderContestContext(user.id);
    if (!context.entry) {
      return NextResponse.json(
        { error: "No Day Trader entry for the current contest." },
        { status: 404 }
      );
    }

    const portfolio = await loadDayTraderPortfolio(context.entry);

    return NextResponse.json({
      contest: context.contest,
      entry: context.entry,
      windowOpen: context.windowOpen,
      canTrade:
        context.windowOpen && context.contest?.status === "open",
      portfolio,
    });
  } catch (error) {
    console.error("Day Trader portfolio error:", error);
    return NextResponse.json(
      { error: "Could not load Day Trader portfolio." },
      { status: 500 }
    );
  }
}

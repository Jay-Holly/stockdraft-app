import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import {
  listDayTraderContestsForAdmin,
  updateDayTraderContestAdmin,
} from "@/lib/day-trader/admin-contest";
import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await isDayTraderAdmin(user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const contests = await listDayTraderContestsForAdmin();
    return NextResponse.json({ contests });
  } catch (error) {
    console.error("Day Trader admin GET error:", error);
    return NextResponse.json(
      { error: "Could not load admin contests." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      contestId?: string;
      contestName?: string;
      dollarPrizeText?: string;
      percentPrizeText?: string;
    };

    const contestId = body.contestId?.trim();
    if (!contestId) {
      return NextResponse.json(
        { error: "contestId is required." },
        { status: 400 }
      );
    }

    const result = await updateDayTraderContestAdmin(user.id, contestId, {
      contestName: body.contestName ?? "",
      dollarPrizeText: body.dollarPrizeText ?? "",
      percentPrizeText: body.percentPrizeText ?? "",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ contest: result.contest });
  } catch (error) {
    console.error("Day Trader admin POST error:", error);
    return NextResponse.json(
      { error: "Could not update contest." },
      { status: 500 }
    );
  }
}

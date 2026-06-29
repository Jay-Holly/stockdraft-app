import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { finalizeDueMatchupsForAllLeagues } from "@/lib/matchup/finalize-week";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await finalizeDueMatchupsForAllLeagues();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Matchup finalization failed:", error);
    return NextResponse.json(
      { error: "Matchup finalization failed" },
      { status: 500 }
    );
  }
}

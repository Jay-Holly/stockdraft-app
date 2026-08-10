import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { seedHumanLeaguesByIds } from "@/lib/matchup/seed-human-schedule";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * No defaults — the two leagues this was built for (SDPL2-00022 and
 * SDPL2-00024) have both been deleted along with the retired SDPL2 format.
 * Pass ?ids=<uuid>,<uuid> to backfill specific leagues.
 */
const DEFAULT_LEAGUE_IDS: string[] = [];

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idsParam = request.nextUrl.searchParams.get("ids");
  const leagueIds = idsParam
    ? idsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : DEFAULT_LEAGUE_IDS;

  try {
    const results = await seedHumanLeaguesByIds(leagueIds);
    return NextResponse.json({ leagueIds, results });
  } catch (error) {
    console.error("Human matchup backfill failed:", error);
    return NextResponse.json(
      { error: "Human matchup backfill failed" },
      { status: 500 }
    );
  }
}

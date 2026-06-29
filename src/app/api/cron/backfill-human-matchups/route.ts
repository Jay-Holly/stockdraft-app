import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { seedHumanLeaguesByIds } from "@/lib/matchup/seed-human-schedule";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const DEFAULT_LEAGUE_IDS = [
  "cf0b58c3-b7df-4478-aa5f-0871cb021bfe", // SDPL2-00022
  "7c7962ba-3a4b-461f-a739-0a785eee8a3e", // SDPL2-00024
];

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

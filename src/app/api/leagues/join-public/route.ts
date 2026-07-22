import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { setActiveLeagueCookie } from "@/lib/league/active-league";
import { joinPublicHumanLeague } from "@/lib/league/human-league";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  let body: { leagueId?: unknown; teamName?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  const teamName = typeof body.teamName === "string" ? body.teamName : "";

  if (!leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const result = await joinPublicHumanLeague(user.id, leagueId, teamName);

  if (result.error || !result.league) {
    return NextResponse.json(
      { error: result.error },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  await setActiveLeagueCookie(result.league.id);

  return NextResponse.json(
    {
      league: result.league,
      activeLeagueId: result.league.id,
      redirectTo: result.redirectTo,
    },
    { headers: NO_STORE_HEADERS }
  );
}

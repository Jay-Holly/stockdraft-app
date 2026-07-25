import { NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";
import { resetPickClockForCommissioner } from "@/lib/draft/live-draft";
import { isSportsSimLeague } from "@/lib/season/sdpl-league";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const;

export async function POST(_request: Request, context: RouteContext) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leagueId } = await context.params;
  const supabase = await createClient();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, owner_user_id, status, league_type, format_type, sports_league_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return NextResponse.json(
      { error: leagueError?.message ?? "League not found." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
  if (
    !isSportsSimLeague({
      formatType: league.format_type,
      sportsLeagueId: league.sports_league_id,
    })
  ) {
    return NextResponse.json(
      { error: "This action is only available for sports sim leagues." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  if (league.owner_user_id !== user.id) {
    return NextResponse.json(
      { error: "Only the league commissioner can reset the draft clock." },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }
  if (league.status !== "drafting") {
    return NextResponse.json(
      { error: "The draft is not currently in progress." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const result = await resetPickClockForCommissioner(leagueId);
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

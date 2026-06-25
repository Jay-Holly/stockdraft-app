import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { setActiveLeagueCookie } from "@/lib/league/active-league";
import {
  getLeagueInvitePreview,
  joinHumanLeagueByToken,
} from "@/lib/league/human-league";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const preview = await getLeagueInvitePreview(token);

  if (!preview) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  const { user } = await getAuthenticatedUserId();
  let isMember = false;
  if (user) {
    const supabase = await createClient();
    const { data: membership } = await supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", preview.leagueId)
      .eq("user_id", user.id)
      .maybeSingle();
    isMember = Boolean(membership);
  }

  return NextResponse.json({ preview, isMember });
}

export async function POST(request: Request, context: RouteContext) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await context.params;
  let body: { teamName?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const teamName = typeof body.teamName === "string" ? body.teamName : "";
  const result = await joinHumanLeagueByToken(user.id, token, teamName);

  if (result.error || !result.league) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await setActiveLeagueCookie(result.league.id);

  return NextResponse.json({
    league: result.league,
    activeLeagueId: result.league.id,
  });
}

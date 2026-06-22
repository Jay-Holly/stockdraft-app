import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { setActiveLeagueCookie } from "@/lib/league/active-league";
import {
  createFreeAiLeague,
  getAiLeagueSummary,
} from "@/lib/league/ai-league";
import { isBotPersonality } from "@/lib/league/bots";
import type { BotPersonality } from "@/lib/league/bots";

export async function POST(request: Request) {
  const { user, supabase } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { botPersonalities?: unknown; teamName?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const raw = body.botPersonalities;
  if (!Array.isArray(raw) || raw.length !== 3) {
    return NextResponse.json(
      { error: "Choose exactly 3 AI opponents." },
      { status: 400 }
    );
  }

  if (!raw.every((value) => typeof value === "string" && isBotPersonality(value))) {
    return NextResponse.json(
      { error: "One or more selected opponents is invalid." },
      { status: 400 }
    );
  }

  const botPersonalities = raw as BotPersonality[];
  if (new Set(botPersonalities).size !== 3) {
    return NextResponse.json(
      { error: "Each AI opponent must be a different personality." },
      { status: 400 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name")
    .eq("id", user.id)
    .single();

  const profileTeamName = profile?.team_name?.trim() || "My Team";
  const rawTeamName =
    typeof body.teamName === "string" ? body.teamName.trim() : "";
  const teamName = rawTeamName || profileTeamName;

  if (teamName.length > 40) {
    return NextResponse.json(
      { error: "Team name must be 40 characters or fewer." },
      { status: 400 }
    );
  }

  const result = await createFreeAiLeague(
    user.id,
    teamName,
    botPersonalities
  );

  if (result.error || !result.league) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await setActiveLeagueCookie(result.league.id);

  const summary = await getAiLeagueSummary(user.id, result.league.id);
  return NextResponse.json({
    league: result.league,
    summary,
    activeLeagueId: result.league.id,
  });
}

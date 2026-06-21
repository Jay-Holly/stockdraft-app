import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { loadLeaguePageData } from "@/lib/roster/server";
import {
  ensureAiLeagueReadyForMatchups,
  scoreCurrentAiMatchup,
} from "@/lib/matchup/scoring";

export async function GET() {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureAiLeagueReadyForMatchups(user.id);
  await scoreCurrentAiMatchup(user.id);

  const result = await loadLeaguePageData(user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data);
}

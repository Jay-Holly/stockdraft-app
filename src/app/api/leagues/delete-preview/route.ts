import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { getLeagueDeletePreview } from "@/lib/league/delete-league";

export async function GET(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leagueId = new URL(request.url).searchParams.get("leagueId");
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId is required." }, { status: 400 });
  }

  const result = await getLeagueDeletePreview(user.id, leagueId);
  if (result.error) {
    const status = result.error === "League not found." ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.preview);
}

import { NextResponse } from "next/server";
import { loadDraftApiPayload } from "@/lib/draft/api";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveActiveAiLeagueId } from "@/lib/league/active-league";

export async function GET(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const leagueId =
    url.searchParams.get("leagueId") ??
    (await resolveActiveAiLeagueId(user.id));

  const result = await loadDraftApiPayload(user.id, {
    leagueId: leagueId ?? undefined,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.partial ?? {}),
        skipProcessingFailed: Boolean(result.partial),
      },
      { status: 500 }
    );
  }

  return NextResponse.json(result.payload);
}

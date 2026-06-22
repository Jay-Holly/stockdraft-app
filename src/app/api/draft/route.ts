import { NextResponse } from "next/server";
import { loadDraftApiPayload } from "@/lib/draft/api";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveActiveAiLeagueId } from "@/lib/league/active-league";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
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

  const elapsedMs = Date.now() - started;

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.partial ?? {}),
        skipProcessingFailed: Boolean(result.partial),
        elapsedMs,
      },
      {
        status: 500,
        headers: { "X-Draft-Load-Ms": String(elapsedMs) },
      }
    );
  }

  return NextResponse.json(result.payload, {
    headers: { "X-Draft-Load-Ms": String(elapsedMs) },
  });
}

import { NextResponse } from "next/server";
import { loadDraftApiPayload } from "@/lib/draft/api";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveActiveLeagueId } from "@/lib/league/active-league";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number, elapsedMs: number) {
  return NextResponse.json(
    { error: message, elapsedMs },
    {
      status,
      headers: { "X-Draft-Load-Ms": String(elapsedMs) },
    }
  );
}

export async function GET(request: Request) {
  const started = Date.now();
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return jsonError("Unauthorized", 401, Date.now() - started);
    }

    const url = new URL(request.url);
    const leagueId =
      url.searchParams.get("leagueId") ??
      (await resolveActiveLeagueId(user.id));

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
  } catch (error) {
    const elapsedMs = Date.now() - started;
    console.error("GET /api/draft failed:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Internal server error loading draft.",
      500,
      elapsedMs
    );
  }
}

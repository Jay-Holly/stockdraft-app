import { NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";
import { resetEntireLeagueDraft } from "@/lib/draft/live-draft";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const;

// Testing-only full-league draft reset. Hard-restricted to a single account
// (not the general commissioner role) since this wipes every team's picks
// in the league, not just the caller's own.
const ALLOWED_USER_ID = "534054c5-6789-47db-8241-d0549b4541db";

export async function POST(_request: Request, context: RouteContext) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.id !== ALLOWED_USER_ID) {
    return NextResponse.json(
      { error: "This action is restricted." },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  const { id: leagueId } = await context.params;
  const supabase = await createClient();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, status")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return NextResponse.json(
      { error: leagueError?.message ?? "League not found." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
  if (league.status !== "drafting") {
    return NextResponse.json(
      { error: "This league's draft is not currently in progress." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const result = await resetEntireLeagueDraft(leagueId);
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

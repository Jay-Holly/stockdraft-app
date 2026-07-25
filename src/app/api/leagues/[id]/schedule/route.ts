import { NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const;

export async function PATCH(request: Request, context: RouteContext) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leagueId } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!("scheduledDraftAt" in body)) {
    return NextResponse.json({ error: "Missing scheduledDraftAt." }, { status: 400 });
  }
  const scheduledDraftAt = body.scheduledDraftAt;
  if (scheduledDraftAt !== null && typeof scheduledDraftAt !== "string") {
    return NextResponse.json({ error: "scheduledDraftAt must be a string or null." }, { status: 400 });
  }

  if (scheduledDraftAt !== null) {
    const parsed = new Date(scheduledDraftAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    }
    if (parsed.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Draft time must be in the future." }, { status: 400 });
    }
  }

  const supabase = await createClient();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, owner_user_id, status, league_type")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return NextResponse.json(
      { error: leagueError?.message ?? "League not found." },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
  if (league.league_type !== "human") {
    return NextResponse.json(
      { error: "This league does not support scheduled drafts." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  if (league.owner_user_id !== user.id) {
    return NextResponse.json(
      { error: "Only the league commissioner can change the draft time." },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }
  if (league.status !== "waiting") {
    return NextResponse.json(
      { error: "The draft has already started — the time can no longer be changed." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const { error: updateError } = await supabase
    .from("leagues")
    .update({ scheduled_draft_at: scheduledDraftAt })
    .eq("id", leagueId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json({ scheduledDraftAt }, { headers: NO_STORE_HEADERS });
}

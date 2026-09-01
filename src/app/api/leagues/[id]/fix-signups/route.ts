import { NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/draft/server";
import { clearScheduledDraftError } from "@/lib/league/scheduled-draft-status";
import { STANDARD_PLAYER_COUNTS } from "@/lib/league/league-config";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const;

const MIN_STANDARD_PLAYER_COUNT = Math.min(...STANDARD_PLAYER_COUNTS);
const MAX_STANDARD_PLAYER_COUNT = Math.max(...STANDARD_PLAYER_COUNTS);

function nearestStandardCountAtLeast(count: number): number | null {
  const fit = STANDARD_PLAYER_COUNTS.filter((n) => n >= count).sort((a, b) => a - b)[0];
  return fit ?? null;
}

async function loadOwnedWaitingSdplLeague(
  supabase: Awaited<ReturnType<typeof getAuthenticatedUserId>>["supabase"],
  leagueId: string,
  userId: string
) {
  const { data: league, error } = await supabase
    .from("leagues")
    .select("id, owner_user_id, status, league_type, sports_league_id, opponent_type")
    .eq("id", leagueId)
    .maybeSingle();

  if (error || !league) {
    return { error: NextResponse.json(
      { error: error?.message ?? "League not found." },
      { status: 404, headers: NO_STORE_HEADERS }
    ) };
  }
  if (league.league_type !== "human" || league.sports_league_id) {
    return { error: NextResponse.json(
      { error: "This league type isn't supported here." },
      { status: 400, headers: NO_STORE_HEADERS }
    ) };
  }
  if (league.owner_user_id !== userId) {
    return { error: NextResponse.json(
      { error: "Only the league commissioner can do this." },
      { status: 403, headers: NO_STORE_HEADERS }
    ) };
  }
  if (league.status !== "waiting") {
    return { error: NextResponse.json(
      { error: "The draft has already started — this can no longer be changed." },
      { status: 400, headers: NO_STORE_HEADERS }
    ) };
  }

  return { league };
}

export async function GET(request: Request, context: RouteContext) {
  const { supabase, user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: leagueId } = await context.params;
  const { league, error } = await loadOwnedWaitingSdplLeague(supabase, leagueId, user.id);
  if (error) return error;

  const { data: members, error: membersError } = await supabase
    .from("league_members")
    .select("user_id, display_name, draft_slot")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  if (membersError) {
    return NextResponse.json(
      { error: membersError.message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    {
      members: (members ?? [])
        .filter((m) => m.user_id !== league!.owner_user_id)
        .map((m) => ({
          id: m.user_id,
          displayName: m.display_name,
        })),
    },
    { headers: NO_STORE_HEADERS }
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { supabase, user } = await getAuthenticatedUserId();
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

  const action = body.action;
  if (action !== "allow_bots" && action !== "shrink_to_fit" && action !== "remove_member") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const { league, error } = await loadOwnedWaitingSdplLeague(supabase, leagueId, user.id);
  if (error) return error;

  if (action === "allow_bots") {
    const { error: updateError } = await supabase
      .from("leagues")
      .update({ opponent_type: "mixed" })
      .eq("id", leagueId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    await clearScheduledDraftError(supabase, leagueId);
    return NextResponse.json({ opponentType: "mixed" }, { headers: NO_STORE_HEADERS });
  }

  if (action === "remove_member") {
    const memberId = body.memberId;
    if (typeof memberId !== "string" || !memberId) {
      return NextResponse.json({ error: "Missing memberId." }, { status: 400 });
    }
    if (memberId === league!.owner_user_id) {
      return NextResponse.json(
        { error: "The commissioner can't be removed this way." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const { error: deleteError } = await supabase
      .from("league_members")
      .delete()
      .eq("league_id", leagueId)
      .eq("user_id", memberId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const { data: remaining, error: remainingError } = await supabase
      .from("league_members")
      .select("user_id, draft_slot")
      .eq("league_id", leagueId)
      .order("draft_slot", { ascending: true, nullsFirst: false });

    if (remainingError) {
      return NextResponse.json(
        { error: remainingError.message },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    // Renumber draft_slot to stay contiguous 0..N-1 — fillEmptySlotsWithBots
    // assumes the occupied slots have no gaps and starts filling at existingCount.
    for (let i = 0; i < (remaining ?? []).length; i++) {
      const member = remaining![i];
      if (member.draft_slot !== i) {
        await supabase
          .from("league_members")
          .update({ draft_slot: i })
          .eq("league_id", leagueId)
          .eq("user_id", member.user_id);
      }
    }

    await clearScheduledDraftError(supabase, leagueId);
    return NextResponse.json(
      { memberCount: remaining?.length ?? 0 },
      { headers: NO_STORE_HEADERS }
    );
  }

  // shrink_to_fit
  const { count: memberCount, error: countError } = await supabase
    .from("league_members")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if (countError) {
    return NextResponse.json(
      { error: countError.message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  const signups = memberCount ?? 0;

  if (signups % 2 !== 0) {
    return NextResponse.json(
      { error: "You have an odd number of players — remove one before shrinking the league." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  if (signups < MIN_STANDARD_PLAYER_COUNT) {
    return NextResponse.json(
      { error: `Private leagues need at least ${MIN_STANDARD_PLAYER_COUNT} players — invite more, or fill with bots instead.` },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  if (signups > MAX_STANDARD_PLAYER_COUNT) {
    return NextResponse.json(
      { error: "This league already has more players than it can be shrunk to." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const target = nearestStandardCountAtLeast(signups);
  if (target == null) {
    return NextResponse.json(
      { error: "Could not find a matching league size." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const { error: updateError } = await supabase
    .from("leagues")
    .update({ player_count: target })
    .eq("id", leagueId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  await clearScheduledDraftError(supabase, leagueId);
  return NextResponse.json({ playerCount: target }, { headers: NO_STORE_HEADERS });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveRequestBaseUrl } from "@/lib/app-url";
import {
  cancelHumanLeagueInvite,
  regenerateHumanLeagueInvite,
} from "@/lib/league/human-league";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { leagueId?: unknown; action?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  const action = body.action;

  if (!leagueId) {
    return NextResponse.json({ error: "leagueId is required." }, { status: 400 });
  }

  if (action === "cancel") {
    const result = await cancelHumanLeagueInvite(user.id, leagueId);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, inviteLink: null });
  }

  if (action === "regenerate") {
    const result = await regenerateHumanLeagueInvite(user.id, leagueId, {
      inviteBaseUrl: resolveRequestBaseUrl(request),
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      inviteToken: result.inviteToken,
      inviteLink: result.inviteLink,
    });
  }

  return NextResponse.json(
    { error: "action must be 'cancel' or 'regenerate'." },
    { status: 400 }
  );
}

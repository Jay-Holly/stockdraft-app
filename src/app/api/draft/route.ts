import { NextResponse } from "next/server";
import {
  getAuthenticatedUserId,
  loadDraftStateDetailed,
  processPushbackSkip,
} from "@/lib/draft/server";

export async function GET() {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await loadDraftStateDetailed(user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const state = result.state;

  if (state.turn.type === "pushback_skip" && state.draft.status !== "complete") {
    await processPushbackSkip(user.id);
    const refreshed = await loadDraftStateDetailed(user.id);
    return NextResponse.json(refreshed.ok ? refreshed.state : state);
  }

  return NextResponse.json(state);
}

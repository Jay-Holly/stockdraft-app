import { NextResponse } from "next/server";
import {
  getAuthenticatedUserId,
  loadDraftState,
  makeDraftPick,
  processAllPushbackSkips,
} from "@/lib/draft/server";
import { loadDraftApiPayload } from "@/lib/draft/api";
import { isLiveDraftLeague } from "@/lib/draft/live-draft";
import { ensureAiLeagueReadyForMatchups } from "@/lib/matchup/scoring";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { symbol, allocation, price, isSearchPick } = body as {
    symbol?: string;
    allocation?: number;
    price?: number;
    isSearchPick?: boolean;
  };

  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const beforeState = await loadDraftState(user.id);
  const leagueId = beforeState?.leagueId;
  const live = leagueId ? await isLiveDraftLeague(leagueId) : false;

  const result = await makeDraftPick(
    user.id,
    symbol,
    allocation,
    price,
    Boolean(isSearchPick)
  );
  if ("error" in result && result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (!live) {
    const skipResult = await processAllPushbackSkips(user.id);
    if (skipResult.error) {
      return NextResponse.json({ error: skipResult.error }, { status: 500 });
    }
  }

  const payloadResult = await loadDraftApiPayload(user.id, {
    leagueId: leagueId ?? undefined,
  });
  if (!payloadResult.ok) {
    return NextResponse.json({ error: payloadResult.error }, { status: 500 });
  }

  const liveComplete =
    live && payloadResult.payload.liveDraft?.status === "complete";

  if (
    ("complete" in result && result.complete) ||
    liveComplete ||
    payloadResult.payload.draft.status === "complete"
  ) {
    await ensureAiLeagueReadyForMatchups(user.id);
  }

  return NextResponse.json({
    ...payloadResult.payload,
    complete:
      ("complete" in result && result.complete) ||
      liveComplete ||
      payloadResult.payload.draft.status === "complete",
  });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUserId, loadDraftState } from "@/lib/draft/server";
import { toggleSafetyPickQueue } from "@/lib/draft/live-draft";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { symbol } = body as { symbol?: string | null };

  if (!symbol || typeof symbol !== "string") {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const state = await loadDraftState(user.id);
  if (!state) {
    return NextResponse.json({ error: "Could not load draft" }, { status: 500 });
  }

  const result = await toggleSafetyPickQueue(
    user.id,
    state.leagueId,
    symbol.toUpperCase()
  );
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    safetyPickQueue: result.queue ?? [],
    safetyPickSymbol: result.queue?.[0] ?? null,
  });
}

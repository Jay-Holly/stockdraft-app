import { NextResponse } from "next/server";
import { getAuthenticatedUserId, loadDraftState } from "@/lib/draft/server";
import { setSafetyPickSymbol } from "@/lib/draft/live-draft";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { symbol } = body as { symbol?: string | null };

  const state = await loadDraftState(user.id);
  if (!state) {
    return NextResponse.json({ error: "Could not load draft" }, { status: 500 });
  }

  const normalized =
    symbol === null || symbol === undefined || symbol === ""
      ? null
      : symbol.toUpperCase();

  const result = await setSafetyPickSymbol(
    user.id,
    state.leagueId,
    normalized
  );
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ safetyPickSymbol: normalized });
}

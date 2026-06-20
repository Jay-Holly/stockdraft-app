import { NextResponse } from "next/server";
import {
  getAuthenticatedUserId,
  loadDraftState,
  makeDraftPick,
} from "@/lib/draft/server";

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

  const state = await loadDraftState(user.id);
  return NextResponse.json({ ...state, complete: result.complete });
}

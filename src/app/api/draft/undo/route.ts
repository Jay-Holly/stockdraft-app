import { NextResponse } from "next/server";
import {
  getAuthenticatedUserId,
  loadDraftState,
  undoLastPick,
} from "@/lib/draft/server";

export async function POST() {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await undoLastPick(user.id);
  if ("error" in result && result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const state = await loadDraftState(user.id);
  return NextResponse.json(state);
}

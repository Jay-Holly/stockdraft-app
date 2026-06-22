import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { loadFreeAgentsPageData } from "@/lib/roster/server";

export async function GET() {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await loadFreeAgentsPageData(user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Could not load free agents unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { loadDraftRecapPageData } from "@/lib/draft/recap";

export async function GET() {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await loadDraftRecapPageData(user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Could not load draft recap unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

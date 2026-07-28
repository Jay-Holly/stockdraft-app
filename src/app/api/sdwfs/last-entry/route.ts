import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const excludeContestId = searchParams.get("excludeContestId");

    let query = supabase
      .from("sdwfs_entries")
      .select("id, contest_id")
      .eq("user_id", user.id)
      .order("entered_at", { ascending: false })
      .limit(1);

    if (excludeContestId) {
      query = query.neq("contest_id", excludeContestId);
    }

    const { data: entry } = await query.maybeSingle();
    if (!entry) {
      return NextResponse.json({ picks: null });
    }

    const { data: picks } = await supabase
      .from("sdwfs_entry_picks")
      .select("sector, symbol")
      .eq("entry_id", entry.id);

    return NextResponse.json({ picks: picks ?? null });
  } catch (error) {
    console.error("SDWFS last-entry error:", error);
    return NextResponse.json({ error: "Could not load lineup." }, { status: 500 });
  }
}

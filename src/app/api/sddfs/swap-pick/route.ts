import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";

export const dynamic = "force-dynamic";

type SwapBody = {
  entryId?: string;
  sector?: string;
  symbol?: string;
};

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as SwapBody;
    const entryId = body.entryId?.trim();
    const sector = body.sector?.trim();
    const symbol = body.symbol?.trim();

    if (!entryId || !sector || !symbol) {
      return NextResponse.json(
        { error: "Missing entryId, sector, or symbol." },
        { status: 400 }
      );
    }

    const { data: entry, error: entryError } = await supabase
      .from("sddfs_entries")
      .select("id, user_id, contest_id, sddfs_contests(status)")
      .eq("id", entryId)
      .maybeSingle();

    if (entryError || !entry) {
      return NextResponse.json({ error: "Entry not found." }, { status: 404 });
    }
    if (entry.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contest = Array.isArray(entry.sddfs_contests)
      ? entry.sddfs_contests[0]
      : entry.sddfs_contests;

    if (contest?.status !== "open") {
      return NextResponse.json(
        { error: "This contest is locked — you can no longer make moves." },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from("sddfs_entry_picks")
      .update({ symbol, updated_at: new Date().toISOString() })
      .eq("entry_id", entryId)
      .eq("sector", sector);

    if (updateError) {
      return NextResponse.json(
        { error: "Could not save your move." },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("SDDFS swap-pick error:", error);
    return NextResponse.json(
      { error: "Could not make that move." },
      { status: 500 }
    );
  }
}

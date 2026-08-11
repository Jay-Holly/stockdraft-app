import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { recordWalletTransaction } from "@/lib/wallet/ledger";

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entryId } = await request.json();

  if (!entryId) {
    return NextResponse.json(
      { error: "Entry ID required" },
      { status: 400 }
    );
  }

  // Get entry to verify ownership
  const { data: entry, error: entryError } = await supabase
    .from("sdwfs_entries")
    .select("id, user_id, contest_id")
    .eq("id", entryId)
    .maybeSingle();

  if (entryError || !entry) {
    return NextResponse.json(
      { error: "Entry not found" },
      { status: 404 }
    );
  }

  if (entry.user_id !== user.id) {
    return NextResponse.json(
      { error: "Cannot delete another user's entry" },
      { status: 403 }
    );
  }

  // Buy-in lives on the contest, not the entry
  const { data: contest } = await supabase
    .from("sdwfs_contests")
    .select("buy_in, status")
    .eq("id", entry.contest_id)
    .maybeSingle();

  if (contest?.status !== "open") {
    return NextResponse.json(
      { error: "This contest is locked — entries can no longer be deleted." },
      { status: 400 }
    );
  }

  const buyIn = Number(contest?.buy_in ?? 0);

  // Delete the entry
  const { error: deleteError } = await supabase
    .from("sdwfs_entries")
    .delete()
    .eq("id", entryId);

  if (deleteError) {
    return NextResponse.json(
      { error: `Failed to delete entry: ${deleteError.message}` },
      { status: 500 }
    );
  }

  // Refund buy-in to wallet
  if (buyIn > 0) {
    try {
      await recordWalletTransaction({
        userId: user.id,
        type: "refund",
        amount: buyIn,
        description: "SDWFS entry deleted",
      });
    } catch (refundError) {
      console.error("Failed to refund buy-in:", refundError);
      return NextResponse.json(
        { error: "Entry deleted but refund failed" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, refunded: buyIn });
}

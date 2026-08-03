import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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
    .from("day_trader_entries")
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

  // Delete the entry
  const { error: deleteError } = await supabase
    .from("day_trader_entries")
    .delete()
    .eq("id", entryId);

  if (deleteError) {
    return NextResponse.json(
      { error: `Failed to delete entry: ${deleteError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

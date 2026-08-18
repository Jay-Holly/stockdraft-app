import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { checkRealMoneyEntryGate } from "@/lib/identity/require-gate";
import { validateDfsPicks } from "@/lib/dfs/validate-picks";

/**
 * Maps a Postgres exception raised inside enter_sddfs_contest to the
 * user-facing message the old three-step version returned for the same
 * condition. The RPC is the single source of truth on whether the entry
 * happened; this only translates its error into English.
 */
function messageForEntryError(error: { message?: string; code?: string } | null): string {
  const msg = error?.message ?? "";
  if (msg.includes("contest_full")) return "This contest is full.";
  if (msg.includes("contest_locked")) return "This contest is locked.";
  if (msg.includes("contest_not_found")) return "Contest not found.";
  if (msg.includes("insufficient_balance")) {
    return "Insufficient wallet balance for this entry fee.";
  }
  if (error?.code === "23505") return "You've already entered this contest.";
  return "Could not enter contest.";
}

export const dynamic = "force-dynamic";

type EnterBody = {
  contestId?: string;
  picks?: { sector: string; symbol: string }[];
};

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const gate = await checkRealMoneyEntryGate(supabase, user.id);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.message }, { status: 403 });
    }

    const body = (await request.json()) as EnterBody;
    const contestId = body.contestId?.trim();
    const picks = body.picks ?? [];

    if (!contestId) {
      return NextResponse.json(
        { error: "Missing contest." },
        { status: 400 }
      );
    }
    if (picks.length !== 12) {
      return NextResponse.json(
        { error: "Lineup must have exactly 12 picks." },
        { status: 400 }
      );
    }

    const pickValidationError = await validateDfsPicks(supabase, picks);
    if (pickValidationError) {
      return NextResponse.json({ error: pickValidationError }, { status: 400 });
    }

    // enter_sddfs_contest (migration 088) does the entry, the fee charge and
    // the 12-pick insert as one database transaction. Three separate writes
    // used to run here with app-level cleanup if a later step failed — but
    // that cleanup only runs if the same request survives long enough to
    // reach it. A request that dies in between (timeout, dropped connection)
    // left an entry charged nothing and holding no picks, which then went on
    // to be scored and paid out as if it were real. The RPC makes that
    // impossible: every write commits together or none of them do.
    const { data: entryId, error: entryError } = await supabase.rpc(
      "enter_sddfs_contest",
      {
        p_contest_id: contestId,
        p_user_id: user.id,
        p_picks: picks,
      }
    );

    if (entryError || !entryId) {
      return NextResponse.json(
        { error: messageForEntryError(entryError) },
        { status: 400 }
      );
    }

    return NextResponse.json({ entryId });
  } catch (error) {
    console.error("SDDFS enter error:", error);
    return NextResponse.json(
      { error: "Could not enter SDDFS contest." },
      { status: 500 }
    );
  }
}

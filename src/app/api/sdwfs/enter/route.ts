import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { checkRealMoneyEntryGate } from "@/lib/identity/require-gate";
import { validateDfsPicks } from "@/lib/dfs/validate-picks";

/**
 * Maps a Postgres exception raised inside enter_sdwfs_contest to the
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

    // enter_sdwfs_contest (migration 088) does the entry, the fee charge and
    // the 12-pick insert as one database transaction — see the matching
    // comment in the SDDFS route for why the old three-step version could
    // leave a charged-nothing, picks-less entry behind if a request died
    // mid-flow, and why a single RPC closes that off entirely.
    const { data: entryId, error: entryError } = await supabase.rpc(
      "enter_sdwfs_contest",
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
    console.error("SDWFS enter error:", error);
    return NextResponse.json(
      { error: "Could not enter SDWFS contest." },
      { status: 500 }
    );
  }
}

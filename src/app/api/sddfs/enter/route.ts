import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { checkRealMoneyEntryGate } from "@/lib/identity/require-gate";
import { recordWalletTransaction } from "@/lib/wallet/ledger";

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

    const { data: contest, error: contestError } = await supabase
      .from("sddfs_contests")
      .select("id, status, buy_in, max_entrants")
      .eq("id", contestId)
      .maybeSingle();

    if (contestError || !contest) {
      return NextResponse.json(
        { error: "Contest not found." },
        { status: 404 }
      );
    }
    if (contest.status !== "open") {
      return NextResponse.json(
        { error: "This contest is locked." },
        { status: 400 }
      );
    }

    if (contest.max_entrants && contest.max_entrants > 0) {
      const { count, error: countError } = await supabase
        .from("sddfs_entries")
        .select("*", { count: "exact", head: true })
        .eq("contest_id", contestId);

      if (!countError && count !== null && count >= contest.max_entrants) {
        return NextResponse.json(
          { error: "This contest is full." },
          { status: 400 }
        );
      }
    }

    const buyIn = Number(contest.buy_in);

    const { data: entry, error: entryError } = await supabase
      .from("sddfs_entries")
      .insert({ contest_id: contestId, user_id: user.id })
      .select("id")
      .single();

    if (entryError || !entry) {
      return NextResponse.json(
        {
          error:
            entryError?.code === "23505"
              ? "You've already entered this contest."
              : "Could not create entry.",
        },
        { status: 400 }
      );
    }

    if (buyIn > 0) {
      const { error: chargeError } = await supabase.rpc("charge_entry_fee", {
        p_user_id: user.id,
        p_amount: buyIn,
        p_description: "SDDFS entry fee",
      });

      if (chargeError) {
        await supabase.from("sddfs_entries").delete().eq("id", entry.id);
        return NextResponse.json(
          {
            error:
              chargeError.message?.includes("insufficient_balance")
                ? "Insufficient wallet balance for this entry fee."
                : "Could not charge entry fee.",
          },
          { status: 400 }
        );
      }
    }

    const { error: picksError } = await supabase.from("sddfs_entry_picks").insert(
      picks.map((pick) => ({
        entry_id: entry.id,
        sector: pick.sector,
        symbol: pick.symbol,
      }))
    );

    if (picksError) {
      await supabase.from("sddfs_entries").delete().eq("id", entry.id);
      if (buyIn > 0) {
        await recordWalletTransaction({
          userId: user.id,
          type: "refund",
          amount: buyIn,
          description: "SDDFS entry failed - lineup save error",
        });
      }
      return NextResponse.json(
        { error: "Could not save your lineup." },
        { status: 400 }
      );
    }

    return NextResponse.json({ entryId: entry.id });
  } catch (error) {
    console.error("SDDFS enter error:", error);
    return NextResponse.json(
      { error: "Could not enter SDDFS contest." },
      { status: 500 }
    );
  }
}

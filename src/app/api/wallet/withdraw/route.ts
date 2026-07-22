import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { getWalletBalance, recordWalletTransaction } from "@/lib/wallet/ledger";

export const dynamic = "force-dynamic";

/**
 * Requesting a withdrawal holds the funds immediately (a 'pending' row
 * counts against the available balance) but doesn't move any real money —
 * automated payouts require Stripe Connect (connected accounts, identity
 * verification, bank linking), which isn't set up yet. This creates the
 * ledger request for manual fulfillment in the meantime.
 */
export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { amountUsd?: number };
    const amountUsd = Number(body.amountUsd);

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return NextResponse.json(
        { error: "Enter a valid withdrawal amount." },
        { status: 400 }
      );
    }

    const balance = await getWalletBalance(user.id);
    if (amountUsd > balance) {
      return NextResponse.json(
        { error: "Withdrawal amount exceeds your available balance." },
        { status: 400 }
      );
    }

    await recordWalletTransaction({
      userId: user.id,
      type: "withdrawal",
      amount: -Math.round(amountUsd * 100) / 100,
      status: "pending",
      description: "Withdrawal requested",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Wallet withdraw error:", error);
    return NextResponse.json(
      { error: "Could not submit withdrawal request." },
      { status: 500 }
    );
  }
}

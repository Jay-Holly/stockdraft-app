import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { getWalletBalance, recordWalletTransaction } from "@/lib/wallet/ledger";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";

/**
 * Withdrawals move real money via Stripe Connect: the amount is transferred
 * from the platform balance to the user's connected account, then Stripe's
 * standard payout schedule sends it to their bank. Requires the user to have
 * completed Connect onboarding (connect_status = 'active').
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: "Withdrawals aren't turned on yet — check back soon." },
        { status: 503 }
      );
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

    const { data: identity } = await supabase
      .from("profile_identity")
      .select("stripe_connect_account_id, connect_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (identity?.connect_status !== "active" || !identity.stripe_connect_account_id) {
      return NextResponse.json(
        {
          error:
            "Finish setting up payouts before withdrawing.",
          code: "connect_not_active",
        },
        { status: 400 }
      );
    }

    const stripe = getStripeClient()!;
    const amountCents = Math.round(amountUsd * 100);

    let transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: amountCents,
        currency: "usd",
        destination: identity.stripe_connect_account_id,
      });
    } catch (transferError) {
      console.error("Stripe transfer failed:", transferError);
      return NextResponse.json(
        { error: "Could not process withdrawal. Try again later." },
        { status: 500 }
      );
    }

    await recordWalletTransaction({
      userId: user.id,
      type: "withdrawal",
      amount: -Math.round(amountUsd * 100) / 100,
      status: "completed",
      stripeReference: transfer.id,
      description: "Withdrawal to bank",
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

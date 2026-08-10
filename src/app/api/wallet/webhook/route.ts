import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind === "wallet_deposit" && session.metadata.userId) {
      const amountUsd = (session.amount_total ?? 0) / 100;
      if (amountUsd > 0) {
        await recordWalletTransaction({
          userId: session.metadata.userId,
          type: "deposit",
          amount: amountUsd,
          status: "completed",
          stripeReference: session.id,
          description: "Deposit via card",
        });
      }
    }
  }

  if (
    event.type === "identity.verification_session.verified" ||
    event.type === "identity.verification_session.requires_input"
  ) {
    const session = event.data.object as Stripe.Identity.VerificationSession;
    const userId = session.metadata?.userId;

    if (userId) {
      const supabase = createServiceClient();

      if (event.type === "identity.verification_session.verified") {
        const outputs = session.verified_outputs;
        await supabase.from("profile_identity").upsert(
          {
            user_id: userId,
            identity_status: "verified",
            date_of_birth: outputs?.dob
              ? `${outputs.dob.year}-${String(outputs.dob.month).padStart(2, "0")}-${String(
                  outputs.dob.day
                ).padStart(2, "0")}`
              : null,
            state: outputs?.address?.state ?? null,
          },
          { onConflict: "user_id" }
        );
      } else {
        await supabase.from("profile_identity").upsert(
          { user_id: userId, identity_status: "failed" },
          { onConflict: "user_id" }
        );
      }
    }
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const userId = account.metadata?.userId;

    if (userId) {
      const supabase = createServiceClient();
      const connectStatus = account.payouts_enabled
        ? "active"
        : account.details_submitted
          ? "onboarding"
          : "restricted";

      await supabase.from("profile_identity").upsert(
        { user_id: userId, stripe_connect_account_id: account.id, connect_status: connectStatus },
        { onConflict: "user_id" }
      );
    }
  }

  return NextResponse.json({ received: true });
}

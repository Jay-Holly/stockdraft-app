import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";

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

  return NextResponse.json({ received: true });
}

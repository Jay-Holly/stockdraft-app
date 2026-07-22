import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveRequestBaseUrl } from "@/lib/app-url";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe/client";
import { MIN_DEPOSIT_USD } from "@/lib/wallet/constants";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: "Deposits aren't turned on yet — check back soon." },
        { status: 503 }
      );
    }

    const body = (await request.json()) as { amountUsd?: number };
    const amountUsd = Number(body.amountUsd);

    if (!Number.isFinite(amountUsd) || amountUsd < MIN_DEPOSIT_USD) {
      return NextResponse.json(
        { error: `Minimum deposit is $${MIN_DEPOSIT_USD}.` },
        { status: 400 }
      );
    }

    const stripe = getStripeClient()!;
    const baseUrl = resolveRequestBaseUrl(request);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "StockDraft Wallet Deposit" },
            unit_amount: Math.round(amountUsd * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { userId: user.id, kind: "wallet_deposit" },
      success_url: `${baseUrl}/my-account?deposit=success`,
      cancel_url: `${baseUrl}/my-account?deposit=canceled`,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Could not start checkout." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Wallet deposit error:", error);
    return NextResponse.json(
      { error: "Could not start deposit." },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveRequestBaseUrl } from "@/lib/app-url";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe/client";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: "Payouts aren't turned on yet — check back soon." },
        { status: 503 }
      );
    }

    const stripe = getStripeClient()!;
    const service = createServiceClient();
    const baseUrl = resolveRequestBaseUrl(request);

    const { data: existing } = await service
      .from("profile_identity")
      .select("stripe_connect_account_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let accountId = existing?.stripe_connect_account_id ?? null;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email ?? undefined,
        metadata: { userId: user.id },
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;

      const { error } = await service.from("profile_identity").upsert(
        {
          user_id: user.id,
          stripe_connect_account_id: accountId,
          connect_status: "onboarding",
        },
        { onConflict: "user_id" }
      );
      if (error) {
        console.error("Failed to record Connect account:", error.message);
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${baseUrl}/my-account?connect=refresh`,
      return_url: `${baseUrl}/my-account?connect=complete`,
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error) {
    console.error("Connect onboard error:", error);
    return NextResponse.json(
      { error: "Could not start payout setup." },
      { status: 500 }
    );
  }
}

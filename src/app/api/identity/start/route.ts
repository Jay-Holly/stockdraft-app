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
        { error: "Identity verification isn't turned on yet — check back soon." },
        { status: 503 }
      );
    }

    const stripe = getStripeClient()!;
    const baseUrl = resolveRequestBaseUrl(request);

    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      metadata: { userId: user.id },
      options: { document: { require_matching_selfie: true } },
      return_url: `${baseUrl}/my-account?identity=complete`,
    });

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("profile_identity")
      .upsert(
        { user_id: user.id, identity_status: "pending", identity_session_id: session.id },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("Failed to record identity session:", error.message);
    }

    if (!session.url) {
      return NextResponse.json(
        { error: "Could not start verification." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Identity start error:", error);
    return NextResponse.json(
      { error: "Could not start verification." },
      { status: 500 }
    );
  }
}

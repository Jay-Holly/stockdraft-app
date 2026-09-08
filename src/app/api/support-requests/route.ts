import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendSupportEmail } from "@/lib/support/notify";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      supportCode?: string | null;
      message?: string;
    };

    if (!body.message?.trim()) {
      return NextResponse.json(
        { error: "Message is required." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // profiles.email is not readable by the `authenticated` role (see
    // supabase/migrations/083_restrict_profile_email_visibility.sql), so the
    // caller's own email is read with the service client. `user.id` comes from
    // the verified session, so this stays scoped to the person asking.
    const { data: profile } = await createServiceClient()
      .from("profiles")
      .select("email")
      .eq("id", user.id)
      .maybeSingle();

    // The auth session's address is the fallback: a signup that created the
    // account but not the profile row would otherwise be locked out of support
    // for a reason the user can neither see nor fix.
    const replyTo = profile?.email ?? user.email;

    if (!replyTo) {
      return NextResponse.json(
        { error: "Your account has no email on file — contact support directly." },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("support_requests").insert({
      user_id: user.id,
      email: replyTo,
      support_code: body.supportCode?.trim() || null,
      message: body.message.trim(),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // The row above is the record of the request. Emailing support is a
    // convenience on top of it, so a failure here is logged and swallowed
    // rather than shown to a user whose message was already saved.
    const notified = await sendSupportEmail({
      userEmail: replyTo,
      userId: user.id,
      supportCode: body.supportCode?.trim() || null,
      message: body.message.trim(),
    });

    if (!notified.sent) {
      console.error("[support-requests] email not sent:", notified.reason);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not send your message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

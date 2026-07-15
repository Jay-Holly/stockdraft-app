import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";

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
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.email) {
      return NextResponse.json(
        { error: "Your account has no email on file — contact support directly." },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("support_requests").insert({
      user_id: user.id,
      email: profile.email,
      support_code: body.supportCode?.trim() || null,
      message: body.message.trim(),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not send your message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

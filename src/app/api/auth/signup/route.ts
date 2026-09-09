import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// Creates the account pre-confirmed so users can sign in immediately,
// since email confirmation is temporarily disabled (no SMTP wired up yet
// for auth emails). Revert to a plain client-side supabase.auth.signUp()
// once that's in place.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      username?: string;
      teamName?: string;
      dayTraderSignup?: boolean;
    };

    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const { error } = await createServiceClient().auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: {
        username: body.username,
        team_name: body.teamName,
        avatar_color: "blue",
        day_trader_signup: body.dayTraderSignup ? "true" : "false",
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not create account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

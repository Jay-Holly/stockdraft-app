import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { markDayTraderJoined } from "@/lib/profile/day-trader";
import { resolveSafeRedirectPath } from "@/lib/auth/redirect-path";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = resolveSafeRedirectPath(searchParams.get("next"));
  const dayTrader = searchParams.get("daytrader") === "1";

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      if (dayTrader && data.user) {
        await markDayTraderJoined(data.user.id);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const loginUrl = new URL("/auth", origin);
  loginUrl.searchParams.set("mode", "login");
  if (next !== "/dashboard") {
    loginUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(loginUrl.toString());
}

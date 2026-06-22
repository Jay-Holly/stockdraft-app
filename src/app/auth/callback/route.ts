import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { markDayTraderJoined } from "@/lib/profile/day-trader";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
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

  return NextResponse.redirect(`${origin}/auth?mode=login`);
}

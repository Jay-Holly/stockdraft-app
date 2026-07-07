import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveSafeRedirectPath } from "@/lib/auth/redirect-path";
import {
  ACTIVE_LEAGUE_COOKIE,
  activeLeagueCookieOptions,
} from "@/lib/league/active-league-cookie";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/dashboard") && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    url.searchParams.set("mode", "login");
    url.searchParams.set(
      "next",
      resolveSafeRedirectPath(`${pathname}${request.nextUrl.search}`)
    );
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/draft") && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    url.searchParams.set("mode", "login");
    url.searchParams.set(
      "next",
      resolveSafeRedirectPath(`${pathname}${request.nextUrl.search}`)
    );
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/draft") && user) {
    const leagueId =
      request.nextUrl.searchParams.get("league") ??
      request.nextUrl.searchParams.get("leagueId");
    if (leagueId) {
      supabaseResponse.cookies.set(
        ACTIVE_LEAGUE_COOKIE,
        leagueId,
        activeLeagueCookieOptions
      );
    }
  }

  if (pathname.startsWith("/auth") && user) {
    const next = resolveSafeRedirectPath(
      request.nextUrl.searchParams.get("next")
    );
    if (next !== "/dashboard") {
      return NextResponse.redirect(new URL(next, request.url));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

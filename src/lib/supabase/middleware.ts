import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveSafeRedirectPath } from "@/lib/auth/redirect-path";
import {
  ACTIVE_LEAGUE_COOKIE,
  activeLeagueCookieOptions,
} from "@/lib/league/active-league-cookie";

/**
 * auth.getUser() is a network call on every request. When Supabase is
 * saturated it can hang until Vercel kills the whole invocation
 * (MIDDLEWARE_INVOCATION_TIMEOUT), which 504s every page — including public
 * ones that never needed a user. Cap the wait instead: if auth does not answer
 * in time we treat the visitor as signed out, so protected pages fall back to
 * the login screen and public pages keep rendering.
 */
const AUTH_TIMEOUT_MS = 3000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

  // .catch() sits on the inner promise so a rejection after the timeout has
  // already resolved never surfaces as an unhandled rejection.
  const userPromise = supabase.auth
    .getUser()
    .then(({ data }) => data.user ?? null)
    .catch((error) => {
      console.error("[middleware] auth.getUser failed:", error);
      return null;
    });

  const user = await withTimeout(userPromise, AUTH_TIMEOUT_MS, null);

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

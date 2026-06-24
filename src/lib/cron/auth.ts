import "server-only";

import type { NextRequest } from "next/server";

function readQuerySecret(request: Request | NextRequest): string | null {
  if ("nextUrl" in request && request.nextUrl) {
    return request.nextUrl.searchParams.get("secret");
  }

  const url = new URL(
    request.url,
    `https://${request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost"}`
  );
  return url.searchParams.get("secret");
}

/**
 * Accepts CRON_SECRET via:
 * - `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron)
 * - `?secret=${CRON_SECRET}` (external schedulers e.g. cron-job.org)
 */
export function verifyCronAuth(request: Request | NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const querySecret = readQuerySecret(request)?.trim();
  return querySecret === secret;
}

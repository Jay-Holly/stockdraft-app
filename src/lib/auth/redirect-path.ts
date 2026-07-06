/** Accept only same-origin relative paths for post-auth redirects. */
export function resolveSafeRedirectPath(
  next: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return fallback;
  }
  return next;
}

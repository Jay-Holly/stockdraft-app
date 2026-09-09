interface AuthErrorLike {
  __isAuthError: true;
  name: string;
  message: string;
  status?: number;
  code?: string;
}

// Same check supabase-js's own (unexported) isAuthError() does internally.
function isAuthError(error: unknown): error is AuthErrorLike {
  return typeof error === "object" && error !== null && "__isAuthError" in error;
}

/**
 * supabase-js falls back to `JSON.stringify(err)` when a network/gateway
 * failure carries no message of its own — on a plain 504 that stringifies
 * to the literal text "{}", which is what users saw during the 2026-09-08
 * Supabase auth outage. Route those through a human message instead of
 * printing the library's raw fallback.
 */
export function getAuthErrorMessage(error: unknown): string {
  if (!isAuthError(error)) {
    return "Something went wrong. Please try again.";
  }

  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (typeof error.status === "number" && error.status >= 500)
  ) {
    return "We couldn't reach the login service. Please try again in a moment.";
  }

  if (error.code === "conflict" || error.status === 409) {
    return "You're signed in on another tab or device. Please wait a moment and try again.";
  }

  const message = error.message?.trim();
  if (!message || message.startsWith("{")) {
    return "Something went wrong. Please try again.";
  }

  return message;
}

import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lets server-only code paths that call the cookie-based createClient()
 * (draft engine functions, mostly) transparently run against a different
 * client — e.g. a service-role client from a cron job with no user
 * session — without threading an override parameter through every function
 * in that call chain. Scoped to the async call stack via runWithSupabaseClient;
 * nothing outside that stack is affected.
 */
const storage = new AsyncLocalStorage<SupabaseClient>();

export function getContextSupabaseClient(): SupabaseClient | undefined {
  return storage.getStore();
}

export function runWithSupabaseClient<T>(
  client: SupabaseClient,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(client, fn);
}

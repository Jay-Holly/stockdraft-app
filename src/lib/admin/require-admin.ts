import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The one real admin check. Every /api/admin/* and /admin/* route calls this
 * rather than rolling its own — a repo-wide grep for "is_admin" turned up a
 * placeholder check in an earlier admin route (a bearer header with no user
 * lookup behind it, flagged in its own comment as "in production, add proper
 * auth"). That is exactly the gap this function closes: it reads the signed-in
 * session, not a header anyone can send, and checks that user's own
 * `profiles.is_admin` flag.
 */
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; status: number }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, status: 401 };

  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!data?.is_admin) return { ok: false, status: 403 };

  return { ok: true, userId: user.id };
}

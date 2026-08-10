import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export type AdminUser = {
  id: string;
  username: string;
  team_name: string;
  email: string | null;
  created_at: string;
  is_admin: boolean;
  league_count: number;
};

type ProfileRow = {
  id: string;
  username: string;
  team_name: string;
  email: string | null;
  created_at: string;
  is_admin: boolean;
  league_members: { count: number }[] | null;
};

export async function listUsersForAdmin(): Promise<AdminUser[]> {
  // Service client: profile emails are not readable through the normal
  // session client, and this page is already gated on is_admin.
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, username, team_name, email, created_at, is_admin, league_members(count)"
    )
    .eq("is_bot", false)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load users: ${error.message}`);
  }

  return ((data ?? []) as ProfileRow[]).map((row) => ({
    id: row.id,
    username: row.username,
    team_name: row.team_name,
    email: row.email,
    created_at: row.created_at,
    is_admin: row.is_admin,
    league_count: row.league_members?.[0]?.count ?? 0,
  }));
}

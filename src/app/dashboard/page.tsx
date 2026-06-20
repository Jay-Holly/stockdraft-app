import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DashboardContent } from "@/components/DashboardContent";
import { Logo } from "@/components/Logo";
import type { DraftPick } from "@/lib/draft/types";
import type { Profile } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=login");
  }

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    const username =
      (user.user_metadata?.username as string) ||
      `player_${user.id.slice(0, 8)}`;
    const teamName =
      (user.user_metadata?.team_name as string) || "My Team";
    const avatarColor =
      (user.user_metadata?.avatar_color as string) || "blue";

    const { data: newProfile } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        username,
        team_name: teamName,
        avatar_color: avatarColor,
      })
      .select()
      .single();

    profile = newProfile;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 mb-4">
            Could not load your profile. Make sure you ran the database migration
            in Supabase.
          </p>
          <Link href="/" className="text-gold hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  let draftPicks: DraftPick[] = [];
  const draftComplete = draft?.status === "complete";

  if (draft?.id && draftComplete) {
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("*")
      .eq("draft_id", draft.id)
      .neq("pick_type", "skip")
      .order("pick_order", { ascending: true });

    draftPicks = (picks ?? []) as DraftPick[];
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <span className="text-xs text-gold font-semibold uppercase tracking-wider">
            Dashboard
          </span>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <DashboardContent
          profile={profile as Profile}
          email={user.email ?? ""}
          draftComplete={draftComplete}
          draftPicks={draftPicks}
        />
      </main>
    </div>
  );
}

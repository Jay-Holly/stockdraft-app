import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  resolveActiveLeagueId,
  getHumanLeagueById,
} from "@/lib/league/active-league";
import { isHumanLeagueDraftFinished } from "@/lib/league/human-league";
import { DraftRoom } from "@/components/draft/DraftRoom";
import { Logo } from "@/components/Logo";
import { LeagueSupportId } from "@/components/league/LeagueSupportId";
import type { Draft } from "@/lib/draft/types";
import type { Profile } from "@/lib/types";

function resolveLeagueQueryParam(
  searchParams: Record<string, string | string[] | undefined>
): string | null {
  const league = searchParams.league ?? searchParams.leagueId;
  if (!league) return null;
  return Array.isArray(league) ? league[0] : league;
}

function canEnterHumanDraftWaitingRoom(league: {
  status: string;
  scheduled_draft_at: string | null;
}): boolean {
  return league.status === "waiting" && Boolean(league.scheduled_draft_at);
}

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const preferredLeagueId = resolveLeagueQueryParam(params);

  const activeLeagueId = await resolveActiveLeagueId(
    user.id,
    preferredLeagueId
  );

  let humanLeague: Awaited<ReturnType<typeof getHumanLeagueById>> = null;

  if (activeLeagueId) {
    humanLeague = await getHumanLeagueById(activeLeagueId);
    const draftFinished =
      humanLeague != null
        ? await isHumanLeagueDraftFinished(humanLeague, user.id)
        : null;

    if (
      humanLeague?.status === "waiting" &&
      !canEnterHumanDraftWaitingRoom(humanLeague)
    ) {
      redirect("/dashboard");
    }
    if (humanLeague && draftFinished) {
      redirect("/league");
    }
  }

  let draft: Draft | null = null;

  if (activeLeagueId) {
    const { data } = await supabase
      .from("drafts")
      .select("*")
      .eq("user_id", user.id)
      .eq("league_id", activeLeagueId)
      .maybeSingle();
    draft = (data as Draft | null) ?? null;
  }

  let leagueSupportCode = humanLeague?.support_code;

  if (!leagueSupportCode && activeLeagueId) {
    const { data: leagueRow } = await supabase
      .from("leagues")
      .select("support_code")
      .eq("id", activeLeagueId)
      .maybeSingle();
    leagueSupportCode = leagueRow?.support_code ?? undefined;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <div className="flex items-center gap-4">
            {leagueSupportCode ? (
              <LeagueSupportId code={leagueSupportCode} />
            ) : null}
            <Link
              href="/dashboard"
              className="text-xs text-muted hover:text-gold transition-colors"
            >
              Dashboard
            </Link>
            <span className="text-xs text-gold font-semibold uppercase tracking-wider">
              Draft Room
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full">
        <DraftRoom
          profile={profile as Profile}
          initialDraft={draft}
          initialLeagueId={activeLeagueId}
        />
      </main>
    </div>
  );
}

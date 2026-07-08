import { NextResponse } from "next/server";
import { loadDraftApiPayload } from "@/lib/draft/api";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveActiveLeagueId } from "@/lib/league/active-league";
import { maybeStartHumanLeagueDraft } from "@/lib/league/draft-scheduler";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Light nudge for the viewer's league only — cron handles bulk scheduled drafts. */
const DRAFT_POLL_MAX_BOTS_PER_RUN = 2;

function jsonError(message: string, status: number, elapsedMs: number) {
  return NextResponse.json(
    { error: message, elapsedMs },
    {
      status,
      headers: { "X-Draft-Load-Ms": String(elapsedMs) },
    }
  );
}

export async function GET(request: Request) {
  const started = Date.now();
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return jsonError("Unauthorized", 401, Date.now() - started);
    }

    const url = new URL(request.url);
    const leagueId = await resolveActiveLeagueId(
      user.id,
      url.searchParams.get("league") ?? url.searchParams.get("leagueId")
    );

    let schedulerNudgeError: string | null = null;

    if (leagueId) {
      try {
        const supabase = await createClient();
        const { data: league } = await supabase
          .from("leagues")
          .select("status, scheduled_draft_at")
          .eq("id", leagueId)
          .eq("league_type", "human")
          .maybeSingle();

        const scheduledAt = league?.scheduled_draft_at
          ? new Date(league.scheduled_draft_at)
          : null;
        const pastDue = Boolean(
          scheduledAt && scheduledAt.getTime() <= Date.now()
        );

        if (league?.status === "waiting" && pastDue) {
          const nudge = await maybeStartHumanLeagueDraft(leagueId, {
            force: true,
            maxBotsPerRun: DRAFT_POLL_MAX_BOTS_PER_RUN,
          });
          if (nudge.error) {
            schedulerNudgeError = nudge.error;
            console.error(
              `[GET /api/draft] scheduled draft nudge failed league=${leagueId}:`,
              nudge.error
            );
          }
        }
      } catch (schedulerError) {
        console.error("Scheduled draft nudge failed:", schedulerError);
        schedulerNudgeError =
          schedulerError instanceof Error
            ? schedulerError.message
            : "Scheduled draft nudge failed.";
      }
    }

    const result = await loadDraftApiPayload(user.id, {
      leagueId: leagueId ?? undefined,
    });

    const elapsedMs = Date.now() - started;

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.partial ?? {}),
          skipProcessingFailed: Boolean(result.partial),
          schedulerNudgeError,
          elapsedMs,
        },
        {
          status: 500,
          headers: { "X-Draft-Load-Ms": String(elapsedMs) },
        }
      );
    }

    return NextResponse.json(
      {
        ...result.payload,
        schedulerNudgeError,
      },
      {
        headers: { "X-Draft-Load-Ms": String(elapsedMs) },
      }
    );
  } catch (error) {
    const elapsedMs = Date.now() - started;
    console.error("GET /api/draft failed:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Internal server error loading draft.",
      500,
      elapsedMs
    );
  }
}

import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Recording the times this system refuses to act.
 *
 * The refusals themselves already exist and are correct — a contest that
 * cannot be priced does not lock, a payout waits for the audit. What did not
 * exist was anywhere to see them. A correct refusal nobody hears about is
 * indistinguishable from a fault, and it is the version that gets
 * screenshotted.
 *
 * Recording a hold is never allowed to fail the thing that raised it. If this
 * module cannot write, it logs and returns; a contest that should stay held
 * stays held regardless. Visibility is important, but it is not more important
 * than the refusal it describes.
 */

export type HoldKind =
  | "contest-lock"
  | "contest-settle"
  | "roster-value"
  | "baseline"
  | "fund-release"
  | "audit-stalled"
  | "sweep-stalled";

export type HoldInput = {
  kind: HoldKind;
  subjectType: string;
  subjectId: string;
  /** Plain language, for a human reading it cold. */
  reason: string;
  detail?: Record<string, unknown>;
};

export type OpenHold = {
  id: number;
  kind: HoldKind;
  subjectType: string;
  subjectId: string;
  reason: string;
  detail: Record<string, unknown> | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
};

/**
 * Opens a hold, or refreshes one that is already open.
 *
 * A condition that repeats every minute stays ONE row with a count and a
 * last-seen time. Ten thousand rows saying the same thing is not visibility,
 * it is noise, and noise is how a real hold gets missed.
 */
export async function recordHold(input: HoldInput): Promise<void> {
  try {
    const supabase = createServiceClient();

    const { data: existing } = await supabase
      .from("system_holds")
      .select("id, occurrences")
      .eq("kind", input.kind)
      .eq("subject_type", input.subjectType)
      .eq("subject_id", input.subjectId)
      .is("resolved_at", null)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("system_holds")
        .update({
          last_seen_at: new Date().toISOString(),
          occurrences: (existing.occurrences as number) + 1,
          // Refresh these too: the reason a hold persists can change (three
          // symbols missing on Monday, one on Tuesday) and the stale version
          // would send someone looking for the wrong thing.
          reason: input.reason,
          detail: input.detail ?? null,
        })
        .eq("id", existing.id);
      return;
    }

    await supabase.from("system_holds").insert({
      kind: input.kind,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      reason: input.reason,
      detail: input.detail ?? null,
    });
  } catch (error) {
    console.error(
      `[holds] could not record ${input.kind} on ${input.subjectType}/${input.subjectId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Closes a hold once the condition clears.
 *
 * Resolved holds are kept rather than deleted. "We held this, then released
 * it, here is when and why" is the record worth having — it is the evidence
 * that the system refuses and then recovers, rather than refusing forever or
 * never refusing at all.
 *
 * Safe to call unconditionally: if nothing is held, nothing happens. Call it
 * on every success path so a hold cannot outlive the problem it describes.
 */
export async function resolveHold(
  kind: HoldKind,
  subjectType: string,
  subjectId: string,
  resolution = "condition cleared"
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from("system_holds")
      .update({ resolved_at: new Date().toISOString(), resolution })
      .eq("kind", kind)
      .eq("subject_type", subjectType)
      .eq("subject_id", subjectId)
      .is("resolved_at", null);
  } catch (error) {
    console.error(
      `[holds] could not resolve ${kind} on ${subjectType}/${subjectId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/** Everything currently held, most recently seen first. */
export async function listOpenHolds(): Promise<OpenHold[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("system_holds")
    .select("id, kind, subject_type, subject_id, reason, detail, first_seen_at, last_seen_at, occurrences")
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false });

  if (error) {
    throw new Error(`[holds] could not list open holds: ${error.message}`);
  }

  return (data ?? []).map((r) => ({
    id: r.id as number,
    kind: r.kind as HoldKind,
    subjectType: r.subject_type as string,
    subjectId: r.subject_id as string,
    reason: r.reason as string,
    detail: (r.detail ?? null) as Record<string, unknown> | null,
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
    occurrences: r.occurrences as number,
  }));
}

/** Recently resolved holds — the record of refusals that later cleared. */
export async function listRecentlyResolvedHolds(limit = 25): Promise<
  Array<OpenHold & { resolvedAt: string; resolution: string | null }>
> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("system_holds")
    .select("id, kind, subject_type, subject_id, reason, detail, first_seen_at, last_seen_at, occurrences, resolved_at, resolution")
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`[holds] could not list resolved holds: ${error.message}`);
  }

  return (data ?? []).map((r) => ({
    id: r.id as number,
    kind: r.kind as HoldKind,
    subjectType: r.subject_type as string,
    subjectId: r.subject_id as string,
    reason: r.reason as string,
    detail: (r.detail ?? null) as Record<string, unknown> | null,
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
    occurrences: r.occurrences as number,
    resolvedAt: r.resolved_at as string,
    resolution: (r.resolution ?? null) as string | null,
  }));
}

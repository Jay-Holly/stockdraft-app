import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canEnterRealMoneyLeague, type EntryGateResult } from "@/lib/identity/age-gate";
import { IDENTITY_NOT_VERIFIED_MESSAGE } from "@/lib/identity/messages";

const GATE_MESSAGES: Record<Exclude<EntryGateResult, { allowed: true }>["reason"], string> = {
  not_verified: IDENTITY_NOT_VERIFIED_MESSAGE,
  underage: "You don't meet the minimum age to play in your state.",
  blocked_state: "Real-money contests aren't available in your state.",
};

export async function checkRealMoneyEntryGate(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const { data: profile, error } = await supabase
    .from("profile_identity")
    .select("identity_status, date_of_birth, state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !profile) {
    return { allowed: false, message: GATE_MESSAGES.not_verified };
  }

  const result = canEnterRealMoneyLeague({
    identityStatus: profile.identity_status,
    dateOfBirth: profile.date_of_birth,
    state: profile.state,
  });

  if (result.allowed) {
    return { allowed: true };
  }

  return { allowed: false, message: GATE_MESSAGES[result.reason] };
}

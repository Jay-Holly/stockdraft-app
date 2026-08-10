import "server-only";

/** States requiring 21+ to play real-money DFS/day-trader contests. */
const AGE_21_STATES = new Set(["AZ", "IA", "LA", "MA"]);

const DEFAULT_MIN_AGE = 18;

/** States where real-money DFS/day-trader contests can't be offered at all. */
export const BLOCKED_STATES = new Set(["WA", "ID", "NV", "MT"]);

export type RealMoneyProfile = {
  identityStatus: string | null;
  dateOfBirth: string | null;
  state: string | null;
};

export type EntryGateResult =
  | { allowed: true }
  | { allowed: false; reason: "not_verified" | "underage" | "blocked_state" };

function minAgeForState(state: string): number {
  return AGE_21_STATES.has(state) ? 21 : DEFAULT_MIN_AGE;
}

function ageFromDob(dob: string, asOf: Date): number {
  const birth = new Date(dob);
  let age = asOf.getFullYear() - birth.getFullYear();
  const monthDiff = asOf.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

export function canEnterRealMoneyLeague(
  profile: RealMoneyProfile,
  now: Date = new Date()
): EntryGateResult {
  if (profile.identityStatus !== "verified" || !profile.dateOfBirth || !profile.state) {
    return { allowed: false, reason: "not_verified" };
  }

  const state = profile.state.toUpperCase();

  if (BLOCKED_STATES.has(state)) {
    return { allowed: false, reason: "blocked_state" };
  }

  const age = ageFromDob(profile.dateOfBirth, now);
  if (age < minAgeForState(state)) {
    return { allowed: false, reason: "underage" };
  }

  return { allowed: true };
}

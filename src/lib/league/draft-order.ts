/**
 * Standard league live-draft pick order generation.
 *
 * Each method assigns pick positions 1..N to managers, producing the snake-draft
 * order array (position 1 picks first in round 1).
 */

export const STANDARD_DRAFT_ORDER_METHODS = [
  "random_shuffle",
  "league_id_seeded",
  "primes_midpoint",
  "evens_midpoint",
  "symmetric_outside_in",
] as const;

export type StandardDraftOrderMethod =
  (typeof STANDARD_DRAFT_ORDER_METHODS)[number];

/** Stored on league — either a fixed method or roll one of the five at draft start. */
export type DraftOrderMethodSetting =
  | StandardDraftOrderMethod
  | "random_method";

export const DRAFT_ORDER_METHOD_LABELS: Record<
  DraftOrderMethodSetting,
  { label: string; description: string }
> = {
  random_shuffle: {
    label: "Random shuffle",
    description: "Standard fair random order (default baseline).",
  },
  league_id_seeded: {
    label: "League ID seed",
    description:
      "Deterministic shuffle seeded by the last digit of this league's ID — same league always gets the same order.",
  },
  primes_midpoint: {
    label: "Prime slots",
    description:
      "Assigns pick positions at prime slot numbers under the midpoint first, then primes above the midpoint, then remaining slots.",
  },
  evens_midpoint: {
    label: "Even slots",
    description:
      "Even-numbered pick positions under the midpoint first, then evens above the midpoint, then remaining slots.",
  },
  symmetric_outside_in: {
    label: "Outside-in pairs",
    description:
      "Pairs highest and lowest pick positions working inward (e.g. 1 & 10, 2 & 9, 3 & 8…).",
  },
  random_method: {
    label: "Random method",
    description:
      "Randomly selects one of the five order methods when the draft starts.",
  },
};

export function isStandardDraftOrderMethod(
  value: string
): value is StandardDraftOrderMethod {
  return (STANDARD_DRAFT_ORDER_METHODS as readonly string[]).includes(value);
}

export function parseDraftOrderMethodSetting(
  value: string | null | undefined
): DraftOrderMethodSetting {
  if (value === "random_method") return "random_method";
  if (value && isStandardDraftOrderMethod(value)) return value;
  return "random_shuffle";
}

export function resolveEffectiveDraftOrderMethod(
  setting: DraftOrderMethodSetting,
  leagueId: string
): StandardDraftOrderMethod {
  if (setting !== "random_method") return setting;

  const pool = [...STANDARD_DRAFT_ORDER_METHODS];
  const seed = leagueIdSeed(leagueId) + Date.now();
  const index = Math.floor(mulberry32(seed)() * pool.length);
  return pool[index] ?? "random_shuffle";
}

function leagueIdSeed(leagueId: string): number {
  const compact = leagueId.replace(/-/g, "");
  const last = compact.slice(-1);
  const parsed = parseInt(last, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Mulberry32 — small seeded PRNG. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fisherYatesShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function midpoint(playerCount: number): number {
  return Math.floor(playerCount / 2);
}

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let d = 3; d * d <= n; d += 2) {
    if (n % d === 0) return false;
  }
  return true;
}

/** Pick-position assignment priority (1-indexed slot numbers). */
export function slotPriorityOrder(
  method: StandardDraftOrderMethod,
  playerCount: number,
  leagueId: string
): number[] {
  const slots = Array.from({ length: playerCount }, (_, index) => index + 1);

  if (method === "random_shuffle") {
    return fisherYatesShuffle(slots);
  }

  if (method === "league_id_seeded") {
    const seed = leagueIdSeed(leagueId) * 997 + playerCount * 13;
    return seededShuffle(slots, seed);
  }

  if (method === "primes_midpoint") {
    const mid = midpoint(playerCount);
    const lowPrimes = slots.filter((slot) => slot < mid && isPrime(slot));
    const highPrimes = slots.filter((slot) => slot > mid && isPrime(slot));
    const used = new Set([...lowPrimes, ...highPrimes]);
    const remainder = slots.filter((slot) => !used.has(slot));
    return [...lowPrimes, ...highPrimes, ...remainder];
  }

  if (method === "evens_midpoint") {
    const mid = midpoint(playerCount);
    const lowEvens = slots.filter((slot) => slot < mid && slot % 2 === 0);
    const highEvens = slots.filter((slot) => slot > mid && slot % 2 === 0);
    const used = new Set([...lowEvens, ...highEvens]);
    const remainder = slots.filter((slot) => !used.has(slot));
    return [...lowEvens, ...highEvens, ...remainder];
  }

  if (method === "symmetric_outside_in") {
    const order: number[] = [];
    let low = 1;
    let high = playerCount;

    while (low < high) {
      order.push(low, high);
      low += 1;
      high -= 1;
    }

    if (low === high) {
      order.push(low);
    }

    return order;
  }

  return fisherYatesShuffle(slots);
}

/**
 * Maps managers to pick positions and returns draft_order (pick 1 first).
 * `memberIds` should be a stable pre-shuffle list (e.g. current draft_slot order).
 */
export function applyStandardDraftOrderMethod(
  memberIds: string[],
  playerCount: number,
  leagueId: string,
  setting: DraftOrderMethodSetting
): string[] {
  if (memberIds.length === 0) return [];

  const count = Math.min(memberIds.length, playerCount);
  const participants = memberIds.slice(0, count);
  const method = resolveEffectiveDraftOrderMethod(setting, leagueId);
  const priority = slotPriorityOrder(method, count, leagueId);

  const slotToUser = new Map<number, string>();
  for (let index = 0; index < count; index++) {
    slotToUser.set(priority[index], participants[index]);
  }

  return Array.from({ length: count }, (_, index) => {
    const userId = slotToUser.get(index + 1);
    if (!userId) {
      throw new Error(`Draft order missing pick position ${index + 1}`);
    }
    return userId;
  });
}

export function describeDraftOrderMethod(
  setting: DraftOrderMethodSetting
): string {
  return DRAFT_ORDER_METHOD_LABELS[setting].label;
}

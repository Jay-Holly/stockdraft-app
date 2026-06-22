import { isCryptoSymbol } from "@/lib/draft/engine";

/** Max queued safety stocks per manager (priority 1 … N). */
export const SAFETY_PICK_QUEUE_MAX = 8;

export function normalizeSafetyPickQueue(
  queue: string[] | null | undefined,
  legacySymbol?: string | null
): string[] {
  const raw =
    queue && queue.length > 0
      ? queue
      : legacySymbol
        ? [legacySymbol]
        : [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of raw) {
    const upper = entry?.trim().toUpperCase();
    if (!upper || isCryptoSymbol(upper) || seen.has(upper)) continue;
    seen.add(upper);
    normalized.push(upper);
    if (normalized.length >= SAFETY_PICK_QUEUE_MAX) break;
  }

  return normalized;
}

export function getSafetyPickQueuePriority(
  queue: string[],
  symbol: string
): number | null {
  const upper = symbol.toUpperCase();
  const index = queue.findIndex((entry) => entry === upper);
  return index >= 0 ? index + 1 : null;
}

export function toggleSafetyPickQueueSymbol(
  queue: string[],
  symbol: string
): { queue: string[]; error?: string } {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return { queue, error: "Symbol is required" };
  if (isCryptoSymbol(upper)) {
    return { queue, error: "Safety queue is for stocks only" };
  }

  const index = queue.indexOf(upper);
  if (index >= 0) {
    return { queue: queue.filter((_, i) => i !== index) };
  }

  if (queue.length >= SAFETY_PICK_QUEUE_MAX) {
    return {
      queue,
      error: `Safety queue is full (${SAFETY_PICK_QUEUE_MAX} stocks max)`,
    };
  }

  return { queue: [...queue, upper] };
}

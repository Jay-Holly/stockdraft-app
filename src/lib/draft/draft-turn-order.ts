/**
 * Live-draft turn order: straight (same slot order every round) vs snake
 * (odd rounds forward, even rounds reverse).
 */

export function resolveUserIdForPickIndex(
  pickIndex: number,
  draftOrder: string[],
  useSnakeOrder: boolean
): string | undefined {
  const count = draftOrder.length;
  if (count === 0 || pickIndex < 0) return undefined;

  const round = Math.floor(pickIndex / count);
  const positionInRound = pickIndex % count;
  const slotIndex =
    useSnakeOrder && round % 2 === 1
      ? count - 1 - positionInRound
      : positionInRound;

  return draftOrder[slotIndex];
}

export function leagueDraftUsesSnakeOrder(
  formatType: string | null | undefined
): boolean {
  return formatType === "sports_league";
}

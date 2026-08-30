/**
 * The name and shape of the price push, shared by the server that sends it and
 * the browser that listens for it.
 *
 * Kept apart from broadcast.ts on purpose: that file is `server-only` because
 * it holds the service-role key, and a client component importing from it
 * would pull a server module into the browser bundle and fail the build. Only
 * the channel name and the payload type are needed on both sides, and neither
 * is a secret.
 */
export const PRICE_CHANNEL = "price-updates";

export type PriceTick = {
  symbol: string;
  price: number;
  changePercent: number | null;
};

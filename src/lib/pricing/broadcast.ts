import "server-only";

import { PRICE_CHANNEL, type PriceTick } from "@/lib/pricing/price-channel";

/**
 * Pushing price changes to browsers.
 *
 * The logger sweeps every minute and, because of write-on-change, already
 * knows exactly which symbols moved — they are the only ones it wrote. This
 * publishes that set to a Supabase Realtime channel so an open page updates
 * itself instead of waiting to ask again.
 *
 * Why broadcast rather than letting clients subscribe to `price_log`:
 * migration 089 makes that table admin-only on purpose — players never see
 * price provenance (which provider answered, what failed, what an admin
 * corrected by hand). Subscribing clients to the table would mean opening it
 * up. A broadcast carries only the symbol and its new price, so nothing about
 * how the price was obtained ever reaches a browser.
 *
 * Sent over HTTP rather than by opening a realtime socket: this runs inside a
 * one-minute serverless invocation, and a socket would have to be established
 * and torn down every single sweep. One POST does the same job.
 *
 * A failed broadcast is never allowed to fail a sweep. The prices are already
 * safely in the log at this point, and every client also polls as a fallback
 * — exactly the belt-and-braces pattern DraftRoom already uses, where realtime
 * is preferred and polling quietly covers for it. A push that doesn't arrive
 * costs one refresh cycle of freshness, nothing more.
 */

export { PRICE_CHANNEL, type PriceTick } from "@/lib/pricing/price-channel";

export async function broadcastPriceChanges(ticks: readonly PriceTick[]): Promise<boolean> {
  if (ticks.length === 0) return true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[price-broadcast] missing Supabase credentials; skipping push");
    return false;
  }

  try {
    const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: PRICE_CHANNEL,
            event: "prices",
            payload: { at: new Date().toISOString(), ticks },
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(
        `[price-broadcast] push failed (${response.status}) for ${ticks.length} symbol(s); clients will fall back to polling`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `[price-broadcast] push threw for ${ticks.length} symbol(s); clients will fall back to polling:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

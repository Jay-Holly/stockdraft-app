import "server-only";

import Stripe from "stripe";

let cachedClient: Stripe | null = null;

/** Not configured until STRIPE_SECRET_KEY is set — deposit/withdraw routes
 * report "not configured" rather than throwing when this returns null, so
 * the wallet UI can ship ahead of the Stripe account being live. */
export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  if (!cachedClient) {
    cachedClient = new Stripe(key);
  }
  return cachedClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

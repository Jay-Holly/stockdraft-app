import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type WalletTransactionType =
  | "deposit"
  | "withdrawal"
  | "win"
  | "entry_fee"
  | "refund";

export type WalletTransactionStatus =
  | "pending"
  | "completed"
  | "failed"
  | "canceled";

export type WalletTransaction = {
  id: string;
  type: WalletTransactionType;
  amount: number;
  status: WalletTransactionStatus;
  description: string | null;
  createdAt: string;
};

export type WalletRange = "month" | "year" | "all";

/** Balance counts completed rows plus pending withdrawals (held the moment
 * a payout is requested, before it's actually paid). */
export async function getWalletBalance(userId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("amount")
    .eq("user_id", userId)
    .in("status", ["completed", "pending"]);

  if (error) {
    throw new Error(`Failed to load wallet balance: ${error.message}`);
  }

  const total = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  return Math.round(total * 100) / 100;
}

function rangeStartIso(range: WalletRange): string | null {
  if (range === "all") return null;

  const now = new Date();
  if (range === "year") {
    return new Date(now.getFullYear(), 0, 1).toISOString();
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export async function listWalletTransactions(
  userId: string,
  range: WalletRange
): Promise<WalletTransaction[]> {
  const supabase = await createClient();
  const startIso = rangeStartIso(range);

  let query = supabase
    .from("wallet_transactions")
    .select("id, type, amount, status, description, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (startIso) {
    query = query.gte("created_at", startIso);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load wallet transactions: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type as WalletTransactionType,
    amount: Number(row.amount),
    status: row.status as WalletTransactionStatus,
    description: row.description,
    createdAt: row.created_at,
  }));
}

/** Service-role write path — only called from the Stripe webhook and the
 * withdrawal-request API, never directly from client code. */
export async function recordWalletTransaction(params: {
  userId: string;
  type: WalletTransactionType;
  amount: number;
  status?: WalletTransactionStatus;
  stripeReference?: string;
  description?: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("wallet_transactions").insert({
    user_id: params.userId,
    type: params.type,
    amount: params.amount,
    status: params.status ?? "completed",
    stripe_reference: params.stripeReference,
    description: params.description,
  });

  if (error) {
    throw new Error(`Failed to record wallet transaction: ${error.message}`);
  }
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { WalletActions } from "@/components/wallet/WalletActions";
import { createClient } from "@/lib/supabase/server";
import {
  getWalletBalance,
  listWalletTransactions,
  type WalletRange,
  type WalletTransaction,
} from "@/lib/wallet/ledger";

const RANGE_LABELS: Record<WalletRange, string> = {
  month: "This Month",
  year: "This Year",
  all: "All Time",
};

function formatSignedUsd(amount: number): string {
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function transactionLabel(tx: WalletTransaction): string {
  if (tx.description) return tx.description;
  switch (tx.type) {
    case "deposit":
      return "Deposit";
    case "withdrawal":
      return tx.status === "pending" ? "Withdrawal (pending)" : "Withdrawal";
    case "win":
      return "Contest winnings";
    case "entry_fee":
      return "Contest entry fee";
    case "refund":
      return "Refund";
    default:
      return "Transaction";
  }
}

export default async function MyAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=login");
  }

  const { range: rawRange } = await searchParams;
  const range: WalletRange =
    rawRange === "year" || rawRange === "all" ? rawRange : "month";

  const [balance, transactions] = await Promise.all([
    getWalletBalance(user.id),
    listWalletTransactions(user.id, range),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <span className="text-xs text-gold font-semibold uppercase tracking-wider">
            My Account
          </span>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-6">
        <Link
          href="/stockdraft-dfs"
          className="inline-block text-sm text-muted hover:text-white transition-colors"
        >
          ← Back to lobby
        </Link>

        <div className="bg-dark-card border border-white/10 rounded-2xl p-6 text-center">
          <p className="text-xs text-muted uppercase tracking-wider">
            Account Balance
          </p>
          <p className="text-4xl font-black text-gold mt-1">
            ${balance.toFixed(2)}
          </p>
          <p className="text-xs text-muted mt-1">
            Includes any winnings credited to your account
          </p>
        </div>

        <WalletActions balance={balance} />

        <div className="bg-dark-card border border-white/10 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent Transactions</h2>
          </div>

          <div className="flex gap-2">
            {(["month", "year", "all"] as WalletRange[]).map((r) => (
              <Link
                key={r}
                href={`/my-account?range=${r}`}
                className={`flex-1 text-center rounded-full py-1.5 text-xs font-semibold uppercase tracking-wide border transition-colors ${
                  range === r
                    ? "bg-gold text-black border-gold"
                    : "border-white/20 text-muted hover:border-white/40"
                }`}
              >
                {RANGE_LABELS[r]}
              </Link>
            ))}
          </div>

          <div className="divide-y divide-white/5">
            {transactions.length === 0 ? (
              <p className="py-6 text-center text-muted text-sm">
                No transactions {range === "all" ? "yet" : `for ${RANGE_LABELS[range].toLowerCase()}`}.
              </p>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {transactionLabel(tx)}
                    </div>
                    <div className="text-xs text-muted">
                      {new Date(tx.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                  <div
                    className={`font-semibold ${
                      tx.amount >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {formatSignedUsd(tx.amount)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

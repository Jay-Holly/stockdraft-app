import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import { listOpenHolds, listRecentlyResolvedHolds } from "@/lib/holds/store";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  "contest-lock": "Contest not locked",
  "contest-settle": "Contest not settled",
  "roster-value": "Roster not valued",
  baseline: "Baseline not set",
  "fund-release": "Payout held",
  "audit-stalled": "Audit stalled",
  "sweep-stalled": "Price sweep stalled",
};

function since(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function AdminHoldsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");
  if (!(await isDayTraderAdmin(user.id))) redirect("/dashboard");

  const [open, resolved] = await Promise.all([
    listOpenHolds(),
    listRecentlyResolvedHolds(15),
  ]);

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">Holds</h1>
          <p className="text-muted text-sm mt-2">
            Every time the system refused to act rather than guess. A hold here
            is the system working — but a hold nobody looks at is the same as
            one that never happened.
          </p>
          <Link href="/admin/prices" className="text-sm underline mt-2 inline-block">
            Prices →
          </Link>
        </div>

        <section className="rounded-lg border p-4">
          <h2 className="font-semibold mb-3">
            Open{" "}
            <span className={open.length > 0 ? "text-red-500" : "text-green-600"}>
              ({open.length})
            </span>
          </h2>

          {open.length === 0 ? (
            <p className="text-muted text-sm">
              Nothing is being held. Every contest that should have scored, scored.
            </p>
          ) : (
            <ul className="space-y-3">
              {open.map((hold) => (
                <li key={hold.id} className="rounded border p-3">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="font-medium">
                      {KIND_LABEL[hold.kind] ?? hold.kind}
                    </span>
                    <span className="text-muted text-xs">
                      first seen {since(hold.firstSeenAt)} · last {since(hold.lastSeenAt)} ·{" "}
                      {hold.occurrences} occurrence{hold.occurrences === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-sm mt-1">{hold.reason}</p>
                  <p className="text-muted text-xs mt-1 font-mono break-all">
                    {hold.subjectType} {hold.subjectId}
                  </p>
                  {hold.detail ? (
                    <pre className="text-xs mt-2 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(hold.detail, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="font-semibold mb-3">Recently released ({resolved.length})</h2>
          {resolved.length === 0 ? (
            <p className="text-muted text-sm">Nothing has been held and released yet.</p>
          ) : (
            <ul className="space-y-2">
              {resolved.map((hold) => (
                <li key={hold.id} className="text-sm">
                  <span className="font-medium">
                    {KIND_LABEL[hold.kind] ?? hold.kind}
                  </span>{" "}
                  <span className="text-muted font-mono text-xs">{hold.subjectId}</span>
                  <span className="text-muted"> — {hold.resolution ?? "cleared"}, </span>
                  <span className="text-muted text-xs">{since(hold.resolvedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

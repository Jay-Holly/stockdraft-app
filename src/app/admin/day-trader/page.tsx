import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { DayTraderAdminForm } from "@/components/day-trader/DayTraderAdminForm";
import { listDayTraderContestsForAdmin } from "@/lib/day-trader/admin-contest";
import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import { resolveDayTraderLeaderboardContest } from "@/lib/day-trader/resolve-contest";

export default async function DayTraderAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=login");
  }

  if (!(await isDayTraderAdmin(user.id))) {
    redirect("/dashboard");
  }

  const [contests, activeContest] = await Promise.all([
    listDayTraderContestsForAdmin(),
    resolveDayTraderLeaderboardContest(),
  ]);

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">Day Trader Admin</h1>
          <p className="text-muted text-sm mt-2">
            Edit contest name and prize copy shown on the leaderboards.
          </p>
        </div>

        <div className="rounded-xl border border-dark-border bg-dark/40 p-4">
          <DayTraderAdminForm
            contests={contests}
            initialContestId={activeContest?.id ?? null}
          />
        </div>
      </div>
    </div>
  );
}

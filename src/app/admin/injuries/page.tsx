import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import { getInjuryLogSnapshot } from "@/lib/injuries/admin-queries";
import { InjuryLogAdmin } from "@/components/admin/InjuryLogAdmin";

export default async function AdminInjuriesPage() {
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

  const snapshot = await getInjuryLogSnapshot();

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">Injuries</h1>
          <p className="text-muted text-sm mt-2">
            The log — every SDFL 2026 player the poller has seen go on IR, and when they came off it.
          </p>
        </div>

        <InjuryLogAdmin initialSnapshot={snapshot} />
      </div>
    </div>
  );
}

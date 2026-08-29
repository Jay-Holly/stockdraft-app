import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import { getPriceLogSnapshot } from "@/lib/pricing/admin-queries";
import { PriceLogAdmin } from "@/components/admin/PriceLogAdmin";

export default async function AdminPricesPage() {
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

  const snapshot = await getPriceLogSnapshot();

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">Prices</h1>
          <p className="text-muted text-sm mt-2">
            The log — every price the logger has ever recorded, and everything it couldn&rsquo;t.
          </p>
        </div>

        <PriceLogAdmin initialSnapshot={snapshot} />
      </div>
    </div>
  );
}

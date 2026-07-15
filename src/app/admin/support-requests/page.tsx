import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import { listSupportRequestsForAdmin } from "@/lib/support/admin";
import { SupportRequestsAdminList } from "@/components/admin/SupportRequestsAdminList";

export default async function SupportRequestsAdminPage() {
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

  const requests = await listSupportRequestsForAdmin();

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">Support Requests</h1>
          <p className="text-muted text-sm mt-2">
            Look someone up by email + league support code to find their
            account and league.
          </p>
        </div>

        <SupportRequestsAdminList initialRequests={requests} />
      </div>
    </div>
  );
}

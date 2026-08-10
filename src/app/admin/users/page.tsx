import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import { listUsersForAdmin } from "@/lib/profile/admin-users";
import { UsersAdminList } from "@/components/admin/UsersAdminList";

export default async function UsersAdminPage() {
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

  const users = await listUsersForAdmin();

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">Users</h1>
          <p className="text-muted text-sm mt-2">
            Everyone who has signed up, newest first. Bots are not shown.
          </p>
        </div>

        <UsersAdminList users={users} />
      </div>
    </div>
  );
}

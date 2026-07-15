import "server-only";

import { createClient } from "@/lib/supabase/server";

export type SupportRequest = {
  id: string;
  user_id: string;
  email: string;
  support_code: string | null;
  message: string;
  status: "open" | "resolved";
  created_at: string;
};

export async function listSupportRequestsForAdmin(): Promise<SupportRequest[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_requests")
    .select("*")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  return (data ?? []) as SupportRequest[];
}

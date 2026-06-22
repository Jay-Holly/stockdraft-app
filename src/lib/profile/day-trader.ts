import { createClient } from "@/lib/supabase/server";

export async function hasJoinedDayTrader(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("day_trader_joined_at")
    .eq("id", userId)
    .maybeSingle();

  return Boolean(data?.day_trader_joined_at);
}

export async function markDayTraderJoined(userId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ day_trader_joined_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) return { error: error.message };
  return {};
}

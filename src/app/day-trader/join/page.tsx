import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  hasJoinedDayTrader,
  markDayTraderJoined,
} from "@/lib/profile/day-trader";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";

export default async function DayTraderJoinPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=daytrader");
  }

  if (await hasJoinedDayTrader(user.id)) {
    redirect("/dashboard");
  }

  async function joinDayTrader() {
    "use server";
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/auth?mode=daytrader");

    const result = await markDayTraderJoined(user.id);
    if (result.error) {
      throw new Error(result.error);
    }

    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col px-4 py-8">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col">
        <div className="text-center mb-8">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">Day Trader Mode</h1>
          <p className="text-muted text-sm mt-2">
            Enter free, track intraday moves, and sharpen your reads before a
            full StockDraft season.
          </p>
        </div>

        <form action={joinDayTrader} className="space-y-4 mt-auto">
          <Button type="submit" variant="primary" className="w-full">
            Join Day Trader — It&apos;s Free
          </Button>
          <Link
            href="/"
            className="block text-center text-sm text-muted hover:text-white"
          >
            Back to home
          </Link>
        </form>
      </div>
    </div>
  );
}

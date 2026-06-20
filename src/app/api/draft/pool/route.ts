import { NextResponse } from "next/server";
import { fetchDraftPool } from "@/lib/draft-pool/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stocks = await fetchDraftPool();

  if (stocks.length === 0) {
    return NextResponse.json(
      {
        error:
          "Draft pool is empty. Run Supabase migration 004_draft_pool.sql.",
        stocks: [],
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { stocks, count: stocks.length },
    {
      headers: {
        "Cache-Control": "private, max-age=3600",
      },
    }
  );
}

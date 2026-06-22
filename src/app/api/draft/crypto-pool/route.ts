import { NextResponse } from "next/server";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const coins = await fetchCryptoPool();

  if (coins.length === 0) {
    return NextResponse.json(
      {
        error:
          "Crypto pool is empty. Run Supabase migration 030_crypto_pool.sql.",
        coins: [],
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { coins, count: coins.length },
    {
      headers: {
        "Cache-Control": "private, max-age=3600",
      },
    }
  );
}

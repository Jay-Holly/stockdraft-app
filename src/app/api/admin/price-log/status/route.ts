import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getPriceLogSnapshot } from "@/lib/pricing/admin-queries";

/** Polled by the admin Prices page — cheap (a handful of indexed reads). */
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const snapshot = await getPriceLogSnapshot();
  return NextResponse.json(snapshot);
}

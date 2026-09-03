import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getInjuryLogSnapshot } from "@/lib/injuries/admin-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const snapshot = await getInjuryLogSnapshot();
  return NextResponse.json(snapshot);
}

import { NextResponse } from "next/server";
import { getPlatformRosteredSymbols } from "@/lib/league/server";

export async function GET() {
  const symbols = await getPlatformRosteredSymbols();
  return NextResponse.json({ symbols });
}

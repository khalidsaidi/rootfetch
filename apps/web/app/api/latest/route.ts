import { NextResponse } from "next/server";
import { loadLatest } from "@/lib/rootfetch-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await loadLatest());
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed_to_load_latest",
        message: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}

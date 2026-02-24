import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  const filePath = path.join(process.cwd(), "public", "rootfetch", "latest.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "latest.json missing" }, { status: 404 });
  }
}

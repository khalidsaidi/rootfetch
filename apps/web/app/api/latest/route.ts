import { promises as fs } from "node:fs";
import path from "node:path";

export async function GET() {
  const filePath = path.join(process.cwd(), "public", "rootfetch", "latest.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ error: "latest.json missing" }, { status: 404 });
  }
}

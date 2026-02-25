import { loadTopTldsCsv } from "@/lib/rootfetch-data";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.vercel.app").replace(/\/$/, "");

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const staticRoutes = ["", "/approved", "/about", "/sectors", "/compare", "/ask"];
  const topRows = await loadTopTldsCsv();
  const topRoutes = topRows.slice(0, 200).map((row) => `/tld/${row.tld}`);
  const urls = [...staticRoutes, ...topRoutes];

  const now = new Date().toISOString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (route) =>
        `  <url><loc>${escapeXml(`${SITE_URL}${route}`)}</loc><lastmod>${now}</lastmod></url>`
    )
    .join("\n")}\n</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

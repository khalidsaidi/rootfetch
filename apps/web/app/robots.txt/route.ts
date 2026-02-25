const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.vercel.app").replace(/\/$/, "");

const BODY = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\nHost: ${SITE_URL.replace(/^https?:\/\//, "")}\n`;

export async function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.vercel.app").replace(/\/$/, "");

const CONTENT = `# RootFetch\n\nRootFetch provides read-only delegation analytics from locally ingested CZDS zone data.\n\n## Public artifacts\n- ${SITE_URL}/rootfetch/latest.json\n- ${SITE_URL}/rootfetch/top_tlds_latest.csv\n- ${SITE_URL}/rootfetch/distribution_latest.json\n- ${SITE_URL}/rootfetch/concentration_latest.json\n- ${SITE_URL}/rootfetch/coverage_latest.json\n- ${SITE_URL}/rootfetch/latest.md\n\n## Metric definitions\n- approved_tlds_count: approved TLDs visible in latest discovery snapshot\n- counted_today_count: observed today (core+rolling)\n- snapshot_rows_today: rows present in today's snapshot\n- counted_ever_count: approved TLDs observed at least once historically\n- missing_ever_count: approved - counted_ever\n- top*_share_pct and hhi: concentration metrics\n`;

export async function GET() {
  return new Response(CONTENT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

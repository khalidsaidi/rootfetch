import Link from "next/link";

export default function AboutPage() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "56px 24px", lineHeight: 1.55 }}>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", letterSpacing: "0.06em", color: "#0b6d51" }}>
        ROOTFETCH METRICS
      </p>
      <h1 style={{ marginTop: 10, marginBottom: 14, fontSize: "2.2rem" }}>What this dashboard reports</h1>
      <p>
        RootFetch tracks DNS-visible delegated activity from CZDS zone snapshots. The core count is the
        number of unique second-level owners with at least one NS delegation record.
      </p>
      <ul style={{ marginTop: 16, marginLeft: 18 }}>
        <li>
          <strong>Primary:</strong> <code>count_ns_sld</code> (delegated SLD owner count)
        </li>
        <li>
          <strong>Secondary:</strong> <code>count_ds_sld</code>, <code>count_glue_hosts</code>, <code>count_ns_rr</code>
        </li>
        <li>
          <strong>Signals:</strong> movers, volatility, sector indices, anomaly scores
        </li>
      </ul>
      <p style={{ marginTop: 16 }}>
        This is a delegation footprint proxy, not a total registration count.
      </p>
      <p style={{ marginTop: 20 }}>
        <Link href="/">Back to dashboard</Link>
      </p>
    </main>
  );
}

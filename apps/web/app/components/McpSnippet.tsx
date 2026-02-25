"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../page.module.css";

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export default function McpSnippet({ siteUrl }: { siteUrl?: string }) {
  const initial = siteUrl ? normalizeBaseUrl(siteUrl) : "";
  const [origin, setOrigin] = useState(initial);

  useEffect(() => {
    if (!origin && typeof window !== "undefined" && window.location?.origin) {
      setOrigin(normalizeBaseUrl(window.location.origin));
    }
  }, [origin]);

  const endpoint = useMemo(() => {
    const base = origin || "https://rootfetch.vercel.app";
    return `${base}/api/mcp`;
  }, [origin]);

  const snippet = `{
  "mcpServers": {
    "rootfetch": { "url": "${endpoint}" }
  }
}`;

  return <pre className={styles.codeBlock}>{snippet}</pre>;
}

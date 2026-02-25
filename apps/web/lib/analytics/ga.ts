"use client";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "";

function canTrack(): boolean {
  return typeof window !== "undefined" && typeof window.gtag === "function" && Boolean(GA_ID);
}

function sendTestCollect(eventName: string) {
  if (typeof window === "undefined" || !GA_ID.startsWith("G-TEST")) {
    return;
  }
  try {
    const endpoint = new URL("https://www.google-analytics.com/g/collect");
    endpoint.searchParams.set("v", "2");
    endpoint.searchParams.set("tid", GA_ID);
    endpoint.searchParams.set("en", eventName);
    endpoint.searchParams.set("cid", "555");
    endpoint.searchParams.set("ul", navigator.language || "en");
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint.toString());
    } else {
      void fetch(endpoint.toString(), { method: "POST", mode: "no-cors", keepalive: true });
    }
  } catch {
    // no-op
  }
}

function pruneParams(params: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export function pageview(url: string) {
  sendTestCollect("page_view");
  if (!canTrack()) {
    return;
  }
  window.gtag("event", "page_view", {
    page_location: url,
    page_path: url,
    page_title: document.title,
  });
}

export function track(eventName: string, params: Record<string, unknown> = {}) {
  sendTestCollect(eventName);
  if (!canTrack()) {
    return;
  }
  window.gtag("event", eventName, pruneParams(params));
}

export function getGaMeasurementId() {
  return GA_ID;
}

"use client";

import { useReportWebVitals } from "next/web-vitals";

import { track } from "@/lib/analytics/ga";

export default function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    track("rf_web_vitals", {
      name: metric.name,
      value: Number(metric.value.toFixed(2)),
      rating: metric.rating,
    });
  });

  return null;
}

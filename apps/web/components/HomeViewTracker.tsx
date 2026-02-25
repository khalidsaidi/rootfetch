"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics/ga";

export default function HomeViewTracker() {
  useEffect(() => {
    track("rootfetch_view", { page_type: "home" });
  }, []);

  return null;
}

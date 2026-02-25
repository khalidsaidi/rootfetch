"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { pageview, track } from "@/lib/analytics/ga";

export default function RouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const key = "rf_session_started";
    if (!sessionStorage.getItem(key)) {
      track("rf_session_start", {});
      sessionStorage.setItem(key, "1");
    }

    const firstVisitKey = "rf_first_visit";
    if (!localStorage.getItem(firstVisitKey)) {
      track("rf_first_visit", {});
      localStorage.setItem(firstVisitKey, "1");
    }
  }, []);

  useEffect(() => {
    const query = searchParams.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    pageview(url);
  }, [pathname, searchParams]);

  return null;
}

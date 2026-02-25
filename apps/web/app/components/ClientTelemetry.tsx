"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics/ga";

export default function ClientTelemetry() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      track("rf_client_error", {
        code: event.error?.name || "client_error",
        where: event.filename || "window.onerror",
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      track("rf_client_error", {
        code: typeof reason === "object" && reason && "name" in reason ? String((reason as { name: unknown }).name) : "unhandled_rejection",
        where: "window.onunhandledrejection",
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

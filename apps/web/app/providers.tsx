"use client";

import { Suspense, type ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";

import ClientTelemetry from "./components/ClientTelemetry";
import RouteTracker from "./components/RouteTracker";
import WebVitalsReporter from "./components/WebVitalsReporter";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Suspense fallback={null}>
        <RouteTracker />
      </Suspense>
      <ClientTelemetry />
      <WebVitalsReporter />
    </ThemeProvider>
  );
}

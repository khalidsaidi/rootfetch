import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";

import Providers from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rootfetch.com";
const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "RootFetch | Delegation Intelligence",
    template: "%s | RootFetch",
  },
  description:
    "RootFetch tracks delegation activity across a deterministic TLD universe with baseline + hybrid coverage, market structure analytics, and AI-ready artifacts.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "RootFetch",
    title: "RootFetch | Delegation Intelligence",
    description:
      "Read-only dashboard for tracked-universe coverage, market concentration, movers, and daily digests generated from local ingestion.",
    images: [
      {
        url: `${siteUrl}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: "RootFetch market structure snapshot",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RootFetch | Delegation Intelligence",
    description:
      "Tracked-universe coverage, top TLD concentration, movers, and AI-native daily summaries.",
    images: [`${siteUrl}/twitter-image`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${display.variable} ${mono.variable} rf-control-shell min-h-screen bg-background font-sans text-foreground antialiased`}>
        {gaMeasurementId ? (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`} strategy="afterInteractive" />
            <Script id="ga-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                window.gtag = gtag;
                gtag('js', new Date());
                gtag('config', '${gaMeasurementId}', { send_page_view: false });
              `}
            </Script>
          </>
        ) : null}
        <Providers>
          <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_16%_18%,rgba(0,212,255,0.08),transparent_36%),radial-gradient(circle_at_82%_12%,rgba(168,85,247,0.1),transparent_34%)]" />
          {children}
          <footer
            data-cross-project-footer
            className="mx-auto mt-8 w-full max-w-6xl border-t border-border/70 px-4 py-5 text-xs text-muted-foreground md:px-8"
          >
            Cross-project:{" "}
            <a href="https://a2abench-api.web.app/stats" className="text-primary hover:underline">
              A2ABench
            </a>{" "}
            ·{" "}
            <a href="https://ragmap-api.web.app/stats" className="text-primary hover:underline">
              Ragmap
            </a>{" "}
            — benchmark · MCP search
          </footer>
        </Providers>
      </body>
    </html>
  );
}

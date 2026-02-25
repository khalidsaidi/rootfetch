import type { Metadata } from "next";

import SectorsClient from "./SectorsClient";

export const metadata: Metadata = {
  title: "Sector Indices",
  description: "Time-series sector index charts and latest sector snapshot for RootFetch delegated-domain data.",
  alternates: {
    canonical: "/sectors",
  },
};

export default function SectorsPage() {
  return <SectorsClient />;
}

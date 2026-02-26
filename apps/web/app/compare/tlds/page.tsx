import type { Metadata } from "next";

import CompareClient from "../CompareClient";

export const metadata: Metadata = {
  title: "Compare TLDs",
  description: "Compare up to three TLD delegated-count time series and deltas.",
  alternates: {
    canonical: "/compare/tlds",
  },
};

export default function CompareTldsPage() {
  return <CompareClient />;
}


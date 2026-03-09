import type { Metadata } from "next";

import ApprovedClient from "@/app/approved/ApprovedClient";

export const metadata: Metadata = {
  title: "TLD Coverage Universe",
  description: "Search every tracked TLD and see snapshot observation status from RootFetch coverage artifacts.",
  alternates: {
    canonical: "/coverage",
  },
};

export default function CoveragePage() {
  return <ApprovedClient />;
}

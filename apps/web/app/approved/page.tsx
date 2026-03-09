import type { Metadata } from "next";

import ApprovedClient from "./ApprovedClient";

export const metadata: Metadata = {
  title: "TLD Coverage Universe",
  description: "Search every tracked TLD and see snapshot observation status from RootFetch coverage artifacts.",
  alternates: {
    canonical: "/approved",
  },
};

export default function ApprovedPage() {
  return <ApprovedClient />;
}

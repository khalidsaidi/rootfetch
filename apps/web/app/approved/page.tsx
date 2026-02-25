import type { Metadata } from "next";

import ApprovedClient from "./ApprovedClient";

export const metadata: Metadata = {
  title: "Approved TLDs",
  description: "Search every CZDS-approved TLD and see counted-today vs counted-before status from RootFetch coverage artifacts.",
  alternates: {
    canonical: "/approved",
  },
};

export default function ApprovedPage() {
  return <ApprovedClient />;
}

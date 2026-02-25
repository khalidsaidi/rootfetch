import type { Metadata } from "next";

import AskClient from "./AskClient";

export const metadata: Metadata = {
  title: "Ask RootFetch",
  description: "AI-native Q&A over RootFetch static RAG artifacts with citations.",
  alternates: {
    canonical: "/ask",
  },
};

export default function AskPage() {
  return <AskClient />;
}

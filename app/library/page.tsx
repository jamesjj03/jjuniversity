import LibraryClient from "@/components/LibraryClient";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Library",
  description: "Browse the full JJ University library of free short books across science, history, religion, psychology, power, money, and more.",
  path: "/library",
});

export default function LibraryPage() {
  return <LibraryClient />;
}

import type { Metadata } from "next";
import PrintReviewEditorWorkspace from "@/components/workshop/PrintReviewEditorWorkspace";
import { readPrintReviewSurface } from "@/lib/printReview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Print Design Lab | JJU Workshop",
  robots: { index: false, follow: false, nocache: true },
};

export default function PrintReviewPage() {
  const surface = readPrintReviewSurface();
  return <PrintReviewEditorWorkspace key={surface.baseDigest} surface={surface} />;
}

import type { Metadata } from "next";
import PrintReviewEditor from "@/components/workshop/PrintReviewEditor";
import { readPrintReviewSurface } from "@/lib/printReview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Print Review | JJU Workshop",
  robots: { index: false, follow: false, nocache: true },
};

export default function PrintReviewPage() {
  const surface = readPrintReviewSurface();
  return <PrintReviewEditor key={surface.baseDigest} surface={surface} />;
}

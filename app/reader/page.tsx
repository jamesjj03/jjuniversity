import ReaderClient from "@/components/ReaderClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reader | JJ University",
  description: "Read JJ University books in the web reader.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function ReaderPage() {
  return <ReaderClient />;
}

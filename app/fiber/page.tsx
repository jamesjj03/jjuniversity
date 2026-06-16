import FiberPage from "@/components/FiberPage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fiber | JJ University",
  description: "A private Kinetic and Frontier fiber quote and contact page for JJ.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function Page() {
  return <FiberPage />;
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

export const metadata: Metadata = {
  title: {
    default: "JJ University",
    template: "%s | JJ University",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function SiteV2Layout({ children }: { children: ReactNode }) {
  return <SiteV2Shell>{children}</SiteV2Shell>;
}

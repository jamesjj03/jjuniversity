import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "@/lib/publishing";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/account", "/settings", "/reader", "/fiber-qr"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}

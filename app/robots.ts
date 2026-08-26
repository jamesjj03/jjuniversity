import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_URL } from "@/lib/publishing";

export default function robots(): MetadataRoute.Robots {
  const privatePaths = ["/admin", "/api", "/fiber-qr"];

  return {
    rules: [
      {
        userAgent: ["OAI-SearchBot", "GPTBot", "ChatGPT-User"],
        allow: "/",
        disallow: privatePaths,
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: privatePaths,
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}

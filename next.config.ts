import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://nzlmnbppynjmutuukmbt.supabase.co";
const supabaseHost = new URL(supabaseUrl).hostname;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/admin/**": ["./private/catalog/books.json", "./private/book-content/**/*.json"],
    "/api/books": ["./private/catalog/books.json"],
    "/api/admin/print-proof/*": ["./private/print-proof-previews/*.png"],
    "/api/admin/book-draft": ["./private/catalog/books.json", "./private/book-content/manifest.json"],
    "/api/admin/content/**": ["./private/book-content/**/*.json"],
    "/api/admin/epub/**": ["./private/book-content/**/*.json"],
    "/api/book/**": ["./private/book-content/**/*.json"],
    "/books/**": ["./private/book-content/**/*.json"],
    "/covers/**": ["./private/catalog/books.json"],
    "/site-v2/books/**": ["./private/book-content/**/*.json"],
    "/sitemap.xml": ["./private/book-content/**/*.json"],
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/book-content/:path*",
          destination: "/api/book-content-unavailable",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/covers/**",
      },
    ],
  },
};

export default nextConfig;

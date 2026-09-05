import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://nzlmnbppynjmutuukmbt.supabase.co";
const supabaseHost = new URL(supabaseUrl).hostname;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/admin/**": ["./private/catalog/books.json", "./private/book-content/**/*.json"],
    "/api/admin/topics": ["./private/catalog/books.json", "./private/catalog/topic-authority.json"],
    "/api/admin/atlas/annotations": [
      "./lib/atlas-world/annotations/data/review-authority.v1.json",
      "./lib/atlas-world/data/pattern-notes.v1.json",
    ],
    "/api/admin/atlas/annotation-drafts": [
      "./lib/atlas-world/annotations/data/draft-authority.v1.json",
      "./lib/atlas-world/layers/catalog.v2.json",
      "./lib/atlas-world/data/countries.v1.json",
      "./lib/atlas-world/data/geography-pack.v1.json",
    ],
    "/api/admin/atlas/associations": [
      "./lib/atlas-world/associations/data/authority.v1.json",
      "./private/catalog/books.json",
    ],
    "/admin/atlas": [
      "./lib/atlas-world/annotations/data/review-authority.v1.json",
      "./lib/atlas-world/annotations/data/draft-authority.v1.json",
      "./lib/atlas-world/associations/data/authority.v1.json",
      "./lib/atlas-world/data/pattern-notes.v1.json",
      "./lib/atlas-world/layers/catalog.v2.json",
      "./lib/atlas-world/data/countries.v1.json",
      "./lib/atlas-world/data/geography-pack.v1.json",
      "./private/catalog/books.json",
    ],
    "/api/admin/print-proof/*": ["./private/print-proof-previews/*.png"],
    "/api/admin/book-draft": ["./private/catalog/books.json", "./private/book-content/manifest.json"],
    "/api/admin/content/**": ["./private/book-content/**/*.json"],
    "/api/admin/epub/**": ["./private/book-content/**/*.json"],
    "/admin/books/\\[id\\]/publication": [
      "./public/_editions/current.json",
      "./public/_editions/editions/*/manifest.json",
      "./public/_editions/editions/*/books/**/*.json",
    ],
    "/covers/**": ["./private/catalog/books.json"],
  },
  async headers() {
    return [
      {
        source: "/_editions/current.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/_editions/editions/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
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

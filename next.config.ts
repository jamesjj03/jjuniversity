import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://nzlmnbppynjmutuukmbt.supabase.co";
const supabaseHost = new URL(supabaseUrl).hostname;

const nextConfig: NextConfig = {
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

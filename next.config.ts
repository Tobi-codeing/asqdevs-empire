import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1600, 1920, 2560],
    /* 82 is the portfolio default; 86 is used for the case-study hero and gallery. */
    qualities: [75, 82, 86, 90],
  },
};

export default nextConfig;

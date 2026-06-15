import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'dist',
  images: {
    unoptimized: true,
  },
  async rewrites() {
    // Rewrites only used in dev mode (next dev).
    // In static export, rewrites are NOT applied.
    const apiBase = process.env.ARCHITXT_UI_API_BASE_URL || 'http://localhost:3000';
    console.log('Rewriting /api/* to:', `${apiBase}/api/v1/*`);
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiBase}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;

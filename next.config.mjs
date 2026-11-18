/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Optimized for unprivileged Proxmox LXC container behind Cloudflare Tunnel
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // Supports batch CSV imports and mobile receipt scans
    },
  },
};

export default nextConfig;

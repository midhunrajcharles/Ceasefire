/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Same-origin proxy (section 5.2). An httpOnly cookie does not survive a
  // cross-origin XHR from :3000 to :8000 without SameSite=None; Secure, which
  // needs HTTPS in dev. Routing the API through /api sidesteps that entirely.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_ORIGIN ?? 'http://localhost:8000'}/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ig-medias-prod.ams3.digitaloceanspaces.com',
      },
      {
        protocol: 'https',
        hostname: 'ams3.digitaloceanspaces.com',
      },
      {
        protocol: 'https',
        hostname: 'immersive-g.com',
      }
    ],
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.(glsl|vs|fs|vert|frag)$/,
      type: 'asset/source',
    });
    return config;
  },
};

export default nextConfig;

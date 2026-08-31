/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
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

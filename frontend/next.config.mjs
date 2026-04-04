/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:6100/api/:path*',
      },
    ];
  },
};

export default nextConfig;
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }

    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:6100/api/:path*',
      },
    ];
  },
};

export default nextConfig;
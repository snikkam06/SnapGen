const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/** @type {import('next').NextConfig} */
const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:3001';

const nextConfig = {
    transpilePackages: ['@snapgen/types', '@snapgen/config'],
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
            { protocol: 'https', hostname: 'picsum.photos' },
            { protocol: 'https', hostname: 'images.unsplash.com' },
        ],
    },
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: `${API_SERVER_URL}/api/:path*`,
            },
        ];
    },
};

module.exports = nextConfig;

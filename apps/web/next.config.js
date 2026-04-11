const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/** @type {import('next').NextConfig} */
function normalizeBaseUrl(value) {
    if (!value) {
        return undefined;
    }

    const trimmed = value.trim();
    const unquoted =
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
            ? trimmed.slice(1, -1)
            : trimmed;

    return unquoted.replace(/\/api\/?$/, '').replace(/\/+$/, '') || undefined;
}

const API_SERVER_URL =
    normalizeBaseUrl(process.env.API_SERVER_URL)
    || normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL)
    || 'http://localhost:3001';

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

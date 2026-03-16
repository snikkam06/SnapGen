const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: ['@snapgen/types', '@snapgen/config'],
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
            { protocol: 'https', hostname: 'picsum.photos' },
            { protocol: 'https', hostname: 'images.unsplash.com' },
        ],
    },
};

module.exports = nextConfig;

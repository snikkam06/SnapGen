import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
    title: 'SnapGen — AI Image & Video Generation Platform',
    description:
        'Create stunning AI-generated images and videos with custom characters. Train models, generate content, and build your AI influencer portfolio.',
    keywords: ['AI image generation', 'AI characters', 'AI influencer', 'image generation', 'video generation'],
    openGraph: {
        title: 'SnapGen — AI Image & Video Generation Platform',
        description: 'Create stunning AI-generated images and videos with custom characters.',
        type: 'website',
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <ClerkProvider
            appearance={{
                variables: {
                    colorPrimary: '#a855f7',
                    colorBackground: '#0a0a0a',
                    colorInputBackground: '#171717',
                    colorInputText: '#fafafa',
                    colorText: '#fafafa',
                    colorTextSecondary: '#a1a1aa',
                },
                elements: {
                    card: 'bg-[#0f0f0f] border border-white/10',
                    formButtonPrimary: 'bg-purple-600 hover:bg-purple-500',
                },
            }}
        >
            <html lang="en" className="dark">
                <body className="min-h-screen bg-background antialiased">{children}</body>
            </html>
        </ClerkProvider>
    );
}

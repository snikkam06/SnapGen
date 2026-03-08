'use client';

import { ClerkFailed, ClerkLoaded, ClerkLoading, SignUp } from '@clerk/nextjs';
import { AuthStatusCard } from '@/components/auth-status-card';

export function SignUpScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-16">
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/3 h-72 w-72 rounded-full bg-purple-600/15 blur-[100px]" />
        <div className="absolute bottom-1/3 right-1/4 h-72 w-72 rounded-full bg-pink-600/15 blur-[100px]" />
      </div>

      <div className="w-full max-w-md text-center">
        <p className="mb-3 text-sm uppercase tracking-[0.24em] text-purple-300">SnapGen</p>
        <h1 className="text-3xl font-bold">Create your SnapGen account</h1>
        <p className="mt-3 text-white/50">
          Start training characters and generating content in minutes.
        </p>

        <ClerkLoading>
          <AuthStatusCard mode="sign-up" state="loading" />
        </ClerkLoading>

        <ClerkFailed>
          <AuthStatusCard mode="sign-up" state="failed" />
        </ClerkFailed>

        <ClerkLoaded>
          <SignUp
            appearance={{
              layout: {
                socialButtonsPlacement: 'top',
                logoImageUrl: '/icon.svg',
              },
              elements: {
                rootBox: 'mx-auto mt-8 w-full',
                card: 'bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl',
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
                socialButtonsBlockButton:
                  'border border-white/20 bg-white text-neutral-950 shadow-[0_12px_32px_rgba(255,255,255,0.08)] hover:bg-white/90',
                socialButtonsBlockButtonText: 'font-semibold text-neutral-950',
                socialButtonsBlockButtonArrow: 'text-neutral-500',
              },
            }}
          />
        </ClerkLoaded>
      </div>
    </div>
  );
}

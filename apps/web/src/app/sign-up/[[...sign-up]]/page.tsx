'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignUp, useAuth } from '@clerk/nextjs';
import { resolveAuthRedirectTarget } from '@/lib/auth-redirect';

export default function SignUpPage() {
  const searchParams = useSearchParams();
  const redirectUrl = resolveAuthRedirectTarget(
    searchParams.get('redirect_url'),
    typeof window === 'undefined' ? undefined : window.location.origin,
  );
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      window.location.replace(redirectUrl);
    }
  }, [isLoaded, isSignedIn, redirectUrl]);

  if (isLoaded && isSignedIn) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-16">
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/4 top-1/3 h-72 w-72 rounded-full bg-purple-600/15 blur-[100px]" />
          <div className="absolute bottom-1/3 right-1/4 h-72 w-72 rounded-full bg-pink-600/15 blur-[100px]" />
        </div>

        <div className="glass-card w-full max-w-md border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
          <p className="text-sm uppercase tracking-[0.24em] text-purple-300">SnapGen</p>
          <h1 className="mt-4 text-3xl font-bold">Redirecting you to the dashboard</h1>
          <p className="mt-3 text-white/50">Your session is active. Taking you to your account now.</p>
        </div>
      </div>
    );
  }

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
      </div>
    </div>
  );
}

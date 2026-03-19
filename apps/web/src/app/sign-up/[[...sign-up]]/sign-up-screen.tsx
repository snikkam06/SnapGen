'use client';

import type { ComponentProps } from 'react';
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignUp } from '@clerk/nextjs';
import { AuthStatusCard } from '@/components/auth-status-card';

const signUpAppearance: NonNullable<ComponentProps<typeof SignUp>['appearance']> = {
  layout: {
    socialButtonsPlacement: 'top',
    logoImageUrl: '/icon.svg',
  },
  variables: {
    colorBackground: '#11131a',
    colorForeground: '#f8fafc',
    colorMutedForeground: 'rgba(226, 232, 240, 0.72)',
    colorInput: 'rgba(255, 255, 255, 0.07)',
    colorInputForeground: '#f8fafc',
    colorBorder: 'rgba(255, 255, 255, 0.14)',
    colorPrimary: '#c084fc',
    colorRing: '#a855f7',
  },
  elements: {
    rootBox: 'mx-auto mt-10 w-full',
    card:
      'overflow-hidden rounded-[1.4rem] border border-white/12 bg-[#11131a]/95 shadow-[0_28px_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl',
    headerTitle: 'hidden',
    headerSubtitle: 'hidden',
    socialButtonsRoot: 'gap-3',
    socialButtonsBlockButton:
      'border border-white/28 bg-white text-neutral-950 shadow-[0_14px_36px_rgba(255,255,255,0.08)] hover:bg-white/92',
    socialButtonsBlockButtonText: 'font-semibold text-neutral-950',
    socialButtonsBlockButtonArrow: 'text-neutral-500',
    dividerRow: 'my-6',
    dividerText: 'text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-white/55',
    dividerLine: 'bg-white/12',
    formFieldRow: 'gap-4',
    formFieldLabelRow: 'mb-2 items-center justify-between',
    formFieldLabel: 'text-sm font-medium text-white/88',
    formFieldAction: 'text-[0.68rem] font-medium uppercase tracking-[0.16em] text-white/56',
    formFieldInput:
      'h-12 rounded-xl border border-white/14 bg-white/[0.06] text-[0.95rem] text-white placeholder:text-white/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition focus:border-purple-400 focus:bg-white/[0.09] focus:ring-2 focus:ring-purple-500/30',
    formFieldInputShowPasswordButton: 'text-white/55 hover:text-white/85',
    formFieldInputShowPasswordIcon: 'text-current',
    formFieldHintText: 'text-xs text-white/55',
    formFieldSuccessText: 'text-xs text-emerald-200',
    formFieldWarningText: 'text-xs text-amber-100',
    formFieldErrorText: 'text-xs text-red-200',
    formButtonPrimary:
      'mt-2 h-12 rounded-xl bg-gradient-to-r from-purple-500 via-fuchsia-500 to-violet-500 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(168,85,247,0.38)] transition hover:brightness-110',
    identityPreview:
      'rounded-2xl border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
    identityPreviewText: 'text-white/82',
    footer: 'border-t border-white/10 bg-[#0b0d12]/80',
    footerItem: 'px-8 py-6',
    footerAction: 'justify-center',
    footerActionText: 'text-sm text-white/70',
    footerActionLink: 'text-sm font-semibold text-purple-300 hover:text-purple-200',
    footerPages: 'text-white/50',
    footerPagesLink: 'text-white/72 hover:text-white',
  },
};

export function SignUpScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(147,51,234,0.2),transparent_34%),linear-gradient(180deg,#06070b_0%,#020202_58%,#05060a_100%)] px-6 py-16 sm:px-8">
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/3 h-80 w-80 rounded-full bg-purple-500/20 blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/4 h-80 w-80 rounded-full bg-pink-500/18 blur-[120px]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black via-black/85 to-transparent" />
      </div>

      <div className="w-full max-w-lg text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.32em] text-purple-200/90">
          mysfw.ai
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.55rem]">
          Create your mysfw.ai account
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-white/68">
          Start training characters and generating content in minutes.
        </p>

        <ClerkLoading>
          <AuthStatusCard mode="sign-up" state="loading" />
        </ClerkLoading>

        <ClerkFailed>
          <AuthStatusCard mode="sign-up" state="failed" />
        </ClerkFailed>

        <ClerkLoaded>
          <SignUp appearance={signUpAppearance} />
        </ClerkLoaded>
      </div>
    </div>
  );
}

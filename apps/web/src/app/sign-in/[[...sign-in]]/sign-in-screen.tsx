'use client';

import Link from 'next/link';
import { FormEvent, useRef, useState } from 'react';
import { ClerkFailed, ClerkLoaded, ClerkLoading, useSignIn } from '@clerk/nextjs';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { AuthStatusCard } from '@/components/auth-status-card';

type SignInAttempt = {
  status: string;
  createdSessionId?: string | null;
  supportedSecondFactors?: Array<{
    strategy: string;
    safeIdentifier?: string | null;
    emailAddressId?: string | null;
  }>;
  create?: (params: { identifier: string }) => Promise<SignInAttempt>;
  attemptFirstFactor?: (params: {
    strategy: 'password';
    password: string;
  }) => Promise<SignInAttempt>;
  prepareSecondFactor?: (params: {
    strategy: 'email_code';
    emailAddressId: string;
  }) => Promise<SignInAttempt>;
  attemptSecondFactor?: (params: {
    strategy: 'email_code';
    code: string;
  }) => Promise<SignInAttempt>;
  authenticateWithRedirect?: (params: {
    strategy: 'oauth_apple' | 'oauth_google';
    redirectUrl: string;
    redirectUrlComplete: string;
  }) => Promise<void>;
};

function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const clerkError = error as {
      errors?: Array<{ longMessage?: string; message?: string }>;
      message?: string;
    };

    return (
      clerkError.errors?.[0]?.longMessage ||
      clerkError.errors?.[0]?.message ||
      clerkError.message ||
      'Unable to sign in right now.'
    );
  }

  return 'Unable to sign in right now.';
}

type SignInScreenProps = {
  redirectUrl: string;
};

export function SignInScreen({ redirectUrl }: SignInScreenProps) {
  const { isLoaded: isSignInLoaded, signIn, setActive } = useSignIn();
  const signInRef = useRef<SignInAttempt | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'credentials' | 'client-trust'>('credentials');
  const [destinationHint, setDestinationHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [oauthStrategy, setOauthStrategy] = useState<'oauth_apple' | 'oauth_google' | null>(null);

  const redirectSignedInUser = () => {
    window.location.replace(redirectUrl);
  };

  const getCurrentAttempt = () => (signInRef.current ?? (signIn as SignInAttempt | undefined)) || null;

  const completeSignIn = async (attempt: SignInAttempt) => {
    if (!attempt.createdSessionId || !setActive) {
      throw new Error('Clerk did not return a session for this sign-in.');
    }

    await setActive({ session: attempt.createdSessionId });
    redirectSignedInUser();
  };

  const prepareClientTrustCode = async (attempt: SignInAttempt, isResend = false) => {
    const emailFactor = attempt.supportedSecondFactors?.find(
      (factor) => factor.strategy === 'email_code' && factor.emailAddressId,
    );

    if (!emailFactor?.emailAddressId || !attempt.prepareSecondFactor) {
      throw new Error('This account needs a second factor that this screen does not support.');
    }

    if (isResend) {
      setIsResendingCode(true);
    }

    try {
      const preparedAttempt = await attempt.prepareSecondFactor({
        strategy: 'email_code',
        emailAddressId: emailFactor.emailAddressId,
      });

      signInRef.current = preparedAttempt;
      setDestinationHint(emailFactor.safeIdentifier || '');
      setStep('client-trust');
      setCode('');
    } finally {
      if (isResend) {
        setIsResendingCode(false);
      }
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isSignInLoaded || !signIn) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const createdAttempt = await (signIn as SignInAttempt).create?.({ identifier });

      if (!createdAttempt?.attemptFirstFactor) {
        throw new Error('Clerk sign-in is not ready yet.');
      }

      signInRef.current = createdAttempt;

      const passwordAttempt = await createdAttempt.attemptFirstFactor({
        strategy: 'password',
        password,
      });

      signInRef.current = passwordAttempt;

      if (passwordAttempt.status === 'complete') {
        await completeSignIn(passwordAttempt);
        return;
      }

      if (
        passwordAttempt.status === 'needs_client_trust' ||
        passwordAttempt.status === 'needs_second_factor'
      ) {
        await prepareClientTrustCode(passwordAttempt);
        return;
      }

      throw new Error(`Unsupported sign-in state: ${passwordAttempt.status}`);
    } catch (caughtError) {
      const errorMessage = getErrorMessage(caughtError);

      if (errorMessage === "You're already signed in.") {
        redirectSignedInUser();
        return;
      }

      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const currentAttempt = getCurrentAttempt();

    if (!currentAttempt?.attemptSecondFactor) {
      setError('Your sign-in session expired. Enter your password again.');
      setStep('credentials');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const verifiedAttempt = await currentAttempt.attemptSecondFactor({
        strategy: 'email_code',
        code,
      });

      signInRef.current = verifiedAttempt;

      if (verifiedAttempt.status === 'complete') {
        await completeSignIn(verifiedAttempt);
        return;
      }

      throw new Error(`Unsupported sign-in state: ${verifiedAttempt.status}`);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    const currentAttempt = getCurrentAttempt();

    if (!currentAttempt) {
      setError('Your sign-in session expired. Enter your password again.');
      setStep('credentials');
      return;
    }

    setError(null);

    try {
      await prepareClientTrustCode(currentAttempt, true);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    }
  };

  const handleOAuthSignIn = async (strategy: 'oauth_apple' | 'oauth_google') => {
    if (!isSignInLoaded || !signIn) {
      return;
    }

    setError(null);
    setOauthStrategy(strategy);

    try {
      await (signIn as SignInAttempt).authenticateWithRedirect?.({
        strategy,
        redirectUrl: '/sign-in/sso-callback',
        redirectUrlComplete: redirectUrl,
      });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      setOauthStrategy(null);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-16">
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/3 h-72 w-72 rounded-full bg-purple-600/15 blur-[100px]" />
        <div className="absolute bottom-1/3 right-1/4 h-72 w-72 rounded-full bg-pink-600/15 blur-[100px]" />
      </div>

      <div className="w-full max-w-md text-center">
        <p className="mb-3 text-sm uppercase tracking-[0.24em] text-purple-300">mysfw.ai</p>
        <h1 className="text-3xl font-bold">
          {step === 'credentials' ? 'Sign in to mysfw.ai' : 'Verify your device'}
        </h1>
        <p className="mt-3 text-white/50">
          {step === 'credentials'
            ? 'Access your dashboard, credits, and generation history.'
            : `Enter the code Clerk sent${destinationHint ? ` to ${destinationHint}` : ' to your email'}.`}
        </p>

        <ClerkLoading>
          <AuthStatusCard mode="sign-in" state="loading" />
        </ClerkLoading>

        <ClerkFailed>
          <AuthStatusCard mode="sign-in" state="failed" />
        </ClerkFailed>

        <ClerkLoaded>
          <div className="glass-card mx-auto mt-8 w-full border border-white/10 bg-white/5 p-8 text-left shadow-2xl backdrop-blur-xl">
            {step === 'credentials' ? (
              <form className="space-y-5" onSubmit={handlePasswordSubmit}>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white px-4 py-3 font-semibold text-neutral-950 shadow-[0_12px_32px_rgba(255,255,255,0.08)] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!isSignInLoaded || isSubmitting || !!oauthStrategy}
                    onClick={() => handleOAuthSignIn('oauth_apple')}
                    type="button"
                  >
                    {oauthStrategy === 'oauth_apple' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>Apple</span>
                  </button>

                  <button
                    className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white px-4 py-3 font-semibold text-neutral-950 shadow-[0_12px_32px_rgba(255,255,255,0.08)] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!isSignInLoaded || isSubmitting || !!oauthStrategy}
                    onClick={() => handleOAuthSignIn('oauth_google')}
                    type="button"
                  >
                    {oauthStrategy === 'oauth_google' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>Google</span>
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-white/30">
                  <span className="h-px flex-1 bg-white/10" />
                  <span>or</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-white/80">Email address</span>
                  <input
                    autoComplete="email"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-purple-400"
                    disabled={!isSignInLoaded || isSubmitting || !!oauthStrategy}
                    name="identifier"
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="Enter your email address"
                    type="email"
                    value={identifier}
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-white/80">Password</span>
                  <input
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-purple-400"
                    disabled={!isSignInLoaded || isSubmitting || !!oauthStrategy}
                    name="password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    type="password"
                    value={password}
                  />
                </label>

                {error ? (
                  <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {error}
                  </p>
                ) : null}

                <button
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!isSignInLoaded || isSubmitting || !!oauthStrategy || !identifier || !password}
                  type="submit"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>Continue</span>
                  {!isSubmitting ? <ArrowRight className="h-4 w-4" /> : null}
                </button>
              </form>
            ) : (
              <form className="space-y-5" onSubmit={handleCodeSubmit}>
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-4 text-sm text-purple-50">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Client trust verification</span>
                  </div>
                  <p className="mt-2 text-purple-100/80">
                    Clerk requires a one-time code before completing this sign-in on a new device.
                  </p>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-white/80">Email code</span>
                  <input
                    autoComplete="one-time-code"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-purple-400"
                    disabled={isSubmitting}
                    inputMode="numeric"
                    name="code"
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="Enter the 6-digit code"
                    type="text"
                    value={code}
                  />
                </label>

                {error ? (
                  <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {error}
                  </p>
                ) : null}

                <button
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting || code.trim().length === 0}
                  type="submit"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>Verify and continue</span>
                  {!isSubmitting ? <ArrowRight className="h-4 w-4" /> : null}
                </button>

                <div className="flex items-center justify-between text-sm text-white/60">
                  <button
                    className="transition hover:text-white"
                    disabled={isSubmitting}
                    onClick={() => {
                      setError(null);
                      setStep('credentials');
                      setCode('');
                    }}
                    type="button"
                  >
                    Use another email
                  </button>

                  <button
                    className="transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSubmitting || isResendingCode}
                    onClick={handleResendCode}
                    type="button"
                  >
                    {isResendingCode ? 'Sending...' : 'Resend code'}
                  </button>
                </div>
              </form>
            )}

            <div className="mt-6 border-t border-white/10 pt-6 text-center text-sm text-white/60">
              Don&apos;t have an account?{' '}
              <Link className="font-medium text-white transition hover:text-purple-300" href="/sign-up">
                Sign up
              </Link>
            </div>
          </div>
        </ClerkLoaded>
      </div>
    </div>
  );
}

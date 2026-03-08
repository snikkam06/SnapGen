'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

type AuthStatusCardProps = {
  mode: 'sign-in' | 'sign-up';
  state: 'loading' | 'failed';
};

const RECOVERY_TIMEOUT_MS = 8000;
const STORAGE_KEY_PREFIXES = ['__clerk', 'clerk_', '__client_uat'];
const COOKIE_KEY_PREFIXES = ['__clerk', '__client_uat', '__session'];

function shouldResetStorageKey(key: string) {
  return STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function shouldResetCookie(name: string) {
  return COOKIE_KEY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function AuthStatusCard({ mode, state }: AuthStatusCardProps) {
  const [showRecoveryActions, setShowRecoveryActions] = useState(state === 'failed');
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    if (state === 'failed') {
      setShowRecoveryActions(true);
      return;
    }

    setShowRecoveryActions(false);

    const timeoutId = window.setTimeout(() => {
      setShowRecoveryActions(true);
    }, RECOVERY_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [state]);

  const heading =
    state === 'loading'
      ? `Connecting to ${mode === 'sign-in' ? 'sign-in' : 'sign-up'}`
      : 'Clerk failed to load in this browser';

  const resetBrowserAuthState = () => {
    setIsResetting(true);

    const removeStorageKeys = (storage: Storage) => {
      for (const key of Object.keys(storage)) {
        if (shouldResetStorageKey(key)) {
          storage.removeItem(key);
        }
      }
    };

    removeStorageKeys(window.localStorage);
    removeStorageKeys(window.sessionStorage);

    for (const rawCookie of document.cookie.split(';')) {
      const [cookieName] = rawCookie.trim().split('=');

      if (!cookieName || !shouldResetCookie(cookieName)) {
        continue;
      }

      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; path=/`;
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; path=/; domain=${window.location.hostname}`;
    }

    window.location.reload();
  };

  if (state === 'loading') {
    return (
      <div className="glass-card mx-auto mt-8 w-full border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-purple-300" />
        <h2 className="mt-4 text-lg font-semibold text-white">{heading}</h2>
        <p className="mt-2 text-sm text-white/60">
          SnapGen is waiting for Clerk to finish loading in your browser.
        </p>

        {showRecoveryActions ? (
          <>
            <p className="mt-4 text-sm text-white/70">
              This is taking longer than expected. In a normal browser profile, the usual causes
              are stale Clerk browser data or an extension blocking Clerk&apos;s dev-domain requests.
            </p>

            <ul className="mt-5 space-y-2 text-left text-sm text-white/70">
              <li>Disable ad blockers, privacy extensions, or Brave shields for `localhost:3000`.</li>
              <li>Turn off VPN or proxy rules that filter third-party scripts, then reload.</li>
              <li>Reset Clerk browser data below if this browser was signed in before.</li>
            </ul>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                onClick={() => window.location.reload()}
                type="button"
              >
                <RefreshCw className="h-4 w-4" />
                Reload page
              </button>

              <button
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isResetting}
                onClick={resetBrowserAuthState}
                type="button"
              >
                {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Reset browser auth state
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="glass-card mx-auto mt-8 w-full border border-amber-400/20 bg-amber-500/10 p-8 text-left shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div>
          <h2 className="text-lg font-semibold text-white">{heading}</h2>
          <p className="mt-2 text-sm text-white/70">
            Google, Apple, and email {mode === 'sign-in' ? 'sign-in' : 'sign-up'} all depend on
            Clerk&apos;s frontend script. This usually means something in the browser blocked
            `*.clerk.accounts.dev` from loading.
          </p>
        </div>
      </div>

      <ul className="mt-5 space-y-2 text-sm text-white/70">
        <li>Disable ad blockers, privacy extensions, or Brave shields for `localhost:3000`.</li>
        <li>Turn off VPN or proxy rules that filter third-party scripts, then reload the page.</li>
        <li>Try an Incognito window with extensions disabled to confirm it is browser-specific.</li>
      </ul>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
          onClick={() => window.location.reload()}
          type="button"
        >
          <RefreshCw className="h-4 w-4" />
          Reload page
        </button>

        <button
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isResetting}
          onClick={resetBrowserAuthState}
          type="button"
        >
          {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Reset browser auth state
        </button>
      </div>
    </div>
  );
}

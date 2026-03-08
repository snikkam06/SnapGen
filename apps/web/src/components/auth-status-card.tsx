'use client';

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

type AuthStatusCardProps = {
  mode: 'sign-in' | 'sign-up';
  state: 'loading' | 'failed';
};

export function AuthStatusCard({ mode, state }: AuthStatusCardProps) {
  if (state === 'loading') {
    return (
      <div className="glass-card mx-auto mt-8 w-full border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-purple-300" />
        <h2 className="mt-4 text-lg font-semibold text-white">
          Connecting to {mode === 'sign-in' ? 'sign-in' : 'sign-up'}
        </h2>
        <p className="mt-2 text-sm text-white/60">
          SnapGen is waiting for Clerk to finish loading in your browser.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card mx-auto mt-8 w-full border border-amber-400/20 bg-amber-500/10 p-8 text-left shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div>
          <h2 className="text-lg font-semibold text-white">Clerk failed to load in this browser</h2>
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

      <button
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
        onClick={() => window.location.reload()}
        type="button"
      >
        <RefreshCw className="h-4 w-4" />
        Reload page
      </button>
    </div>
  );
}

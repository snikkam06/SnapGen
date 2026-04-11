'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function AuthSync({ children }: { children: React.ReactNode }) {
    const { getToken, isLoaded, userId } = useAuth();
    const queryClient = useQueryClient();
    const syncedUserId = useRef<string | null>(null);
    const [retryNonce, setRetryNonce] = useState(0);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ready' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!isLoaded) {
            setSyncStatus('idle');
            return;
        }

        if (!userId) {
            syncedUserId.current = null;
            setSyncStatus('idle');
            setErrorMessage(null);
            return;
        }

        if (syncedUserId.current === userId) {
            setSyncStatus('ready');
            return;
        }

        let cancelled = false;
        setSyncStatus('syncing');
        setErrorMessage(null);

        void (async () => {
            try {
                const token = await getToken();
                if (cancelled) {
                    return;
                }

                if (!token) {
                    throw new Error('Authentication token unavailable');
                }

                await api.syncAuth(token);
                if (cancelled) {
                    return;
                }

                syncedUserId.current = userId;
                setSyncStatus('ready');
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['me'] }),
                    queryClient.invalidateQueries({ queryKey: ['credits', userId] }),
                    queryClient.invalidateQueries({ queryKey: ['assets', userId] }),
                    queryClient.invalidateQueries({ queryKey: ['characters', userId] }),
                    queryClient.invalidateQueries({ queryKey: ['jobs', userId] }),
                ]);
            } catch (error) {
                if (cancelled) {
                    return;
                }

                console.error('[AuthSync] Failed to sync user with API', error);
                setSyncStatus('error');
                setErrorMessage(
                    error instanceof Error ? error.message : 'Failed to initialize your account',
                );
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [getToken, isLoaded, queryClient, retryNonce, userId]);

    if (!isLoaded || syncStatus === 'idle' || syncStatus === 'syncing') {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-6">
                <div className="glass-card max-w-md p-8 text-center">
                    <h1 className="text-2xl font-bold">Preparing your dashboard</h1>
                    <p className="mt-3 text-sm text-white/50">
                        Syncing your account with the API.
                    </p>
                </div>
            </div>
        );
    }

    if (syncStatus === 'error') {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-6">
                <div className="glass-card max-w-md p-8 text-center">
                    <h1 className="text-2xl font-bold">Account sync failed</h1>
                    <p className="mt-3 text-sm text-white/50">
                        {errorMessage || 'The API could not finish creating your account.'}
                    </p>
                    <button
                        type="button"
                        className="mt-6 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
                        onClick={() => setRetryNonce((value) => value + 1)}
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

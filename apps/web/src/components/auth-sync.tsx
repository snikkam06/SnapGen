'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function AuthSync() {
    const { getToken, isLoaded, userId } = useAuth();
    const queryClient = useQueryClient();
    const syncedUserId = useRef<string | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [retryNonce, setRetryNonce] = useState(0);

    useEffect(() => {
        if (!isLoaded || !userId || syncedUserId.current === userId) {
            return;
        }

        let cancelled = false;

        void (async () => {
            try {
                const token = await getToken();
                if (!token || cancelled) {
                    return;
                }

                await api.syncAuth(token);
                syncedUserId.current = userId;
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
                retryTimerRef.current = setTimeout(() => {
                    setRetryNonce((value) => value + 1);
                }, 3000);
            }
        })();

        return () => {
            cancelled = true;
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };
    }, [getToken, isLoaded, queryClient, retryNonce, userId]);

    return null;
}

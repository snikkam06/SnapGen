'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function AuthSync() {
    const { getToken, isLoaded, userId } = useAuth();
    const queryClient = useQueryClient();
    const syncedUserId = useRef<string | null>(null);

    useEffect(() => {
        if (!isLoaded || !userId || syncedUserId.current === userId) {
            return;
        }

        let cancelled = false;

        void (async () => {
            const token = await getToken();
            if (!token || cancelled) {
                return;
            }

            await api.syncAuth(token);
            syncedUserId.current = userId;
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['me'] }),
                queryClient.invalidateQueries({ queryKey: ['credits'] }),
            ]);
        })();

        return () => {
            cancelled = true;
        };
    }, [getToken, isLoaded, queryClient, userId]);

    return null;
}

'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';

export function useApiToken() {
    const { getToken, isLoaded, userId } = useAuth();

    return useQuery({
        queryKey: ['api-token', userId],
        enabled: isLoaded && !!userId,
        staleTime: 0,
        refetchInterval: 30 * 1000,
        refetchIntervalInBackground: true,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        queryFn: async () => {
            const token = await getToken();
            if (!token) {
                throw new Error('Authentication token unavailable');
            }

            return token;
        },
    });
}

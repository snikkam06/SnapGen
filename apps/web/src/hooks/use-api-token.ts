'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';

export function useApiToken() {
    const { getToken, isLoaded, userId } = useAuth();

    return useQuery({
        queryKey: ['api-token', userId],
        enabled: isLoaded && !!userId,
        staleTime: 5 * 60 * 1000,
        queryFn: async () => {
            const token = await getToken();
            if (!token) {
                throw new Error('Authentication token unavailable');
            }

            return token;
        },
    });
}

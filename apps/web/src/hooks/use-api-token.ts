'use client';

import { useAuth } from '@clerk/nextjs';

interface ApiTokenState {
  getToken: () => Promise<string | null>;
  isPending: boolean;
  isReady: boolean;
  userId: string | null;
}

export function useApiToken(): ApiTokenState {
  const { getToken, isLoaded, userId } = useAuth();

  return {
    getToken: () => getToken(),
    isPending: !isLoaded,
    isReady: isLoaded && !!userId,
    userId: userId ?? null,
  };
}

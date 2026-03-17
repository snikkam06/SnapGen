'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiToken } from './use-api-token';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api';

interface JobEvent {
  jobId: string;
  jobType: string;
  status: string;
  reservedCredits: number;
  finalCredits: number | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  outputs?: Array<{ id: string; url: string; mimeType: string }>;
}

export function useJobSSE() {
  const tokenQuery = useApiToken();
  const token = tokenQuery.data;
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;

    let closed = false;
    const reconnectDelayMs = 5000;

    const scheduleReconnect = () => {
      if (closed || reconnectTimerRef.current) {
        return;
      }

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, reconnectDelayMs);
    };

    function handleJobEvent(event: JobEvent) {
      queryClient.setQueriesData(
        { queryKey: ['job'] },
        (oldData: unknown) => {
          if (!oldData || typeof oldData !== 'object') return oldData;
          const old = oldData as { id?: string };
          if (old.id !== event.jobId) return oldData;
          return { ...oldData, ...event };
        },
      );

      void queryClient.invalidateQueries({ queryKey: ['jobs'] });

      if (event.status === 'completed' || event.status === 'failed') {
        void queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === 'job' &&
            query.queryKey[2] === event.jobId,
        });

        if (event.status === 'completed') {
          void queryClient.invalidateQueries({ queryKey: ['assets'] });
        }

        if (event.status === 'failed') {
          void queryClient.invalidateQueries({ queryKey: ['credits'] });
        }
      }
    }

    function connect() {
      if (closed) return;

      const url = `${API_BASE_URL}/v1/events/jobs/stream`;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortController.signal,
      })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            scheduleReconnect();
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!closed) {
            const { done, value } = await reader.read();
            if (done) {
              scheduleReconnect();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            let currentEvent = '';
            let currentData = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                currentData = line.slice(6);
              } else if (line === '' && currentData) {
                // End of SSE message
                if (currentEvent === 'job.updated' || !currentEvent) {
                  try {
                    handleJobEvent(JSON.parse(currentData) as JobEvent);
                  } catch {
                    // Ignore malformed events
                  }
                }
                currentEvent = '';
                currentData = '';
              }
            }
          }
          if (!closed) {
            scheduleReconnect();
          }
        })
        .catch((err) => {
          if (closed || err.name === 'AbortError') return;
          console.warn('[SSE] Connection error, reconnecting in 5s');
          scheduleReconnect();
        });
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [token, queryClient]);
}

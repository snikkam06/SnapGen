'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiToken } from './use-api-token';
import { getBrowserApiBaseUrl } from '@/lib/api-base-url';

const API_BASE_URL = getBrowserApiBaseUrl();

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
  const { getToken, isReady, userId } = tokenQuery;
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(2000);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 20;

  useEffect(() => {
    if (!isReady || !userId) return;

    let closed = false;
    const INITIAL_DELAY = 2000;
    const MAX_DELAY = 60000;

    const scheduleReconnect = () => {
      if (closed || reconnectTimerRef.current) {
        return;
      }

      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[SSE] Max reconnection attempts reached, giving up');
        return;
      }
      reconnectAttemptsRef.current += 1;

      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_DELAY);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, delay);
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

    async function connect() {
      if (closed) return;

      const url = `${API_BASE_URL}/v1/events/jobs/stream`;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const token = await getToken();
      if (!token) {
        scheduleReconnect();
        return;
      }

      fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortController.signal,
      })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            scheduleReconnect();
            return;
          }

          reconnectDelayRef.current = INITIAL_DELAY;
          reconnectAttemptsRef.current = 0;

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let currentEvent = '';
          let currentData = '';

          const flushEvent = () => {
            if (!currentData) {
              currentEvent = '';
              return;
            }

            if (currentEvent === 'job.updated') {
              try {
                handleJobEvent(JSON.parse(currentData) as JobEvent);
              } catch (err) {
                console.warn('[SSE] Failed to parse job event:', currentData, err);
              }
            } else if (currentEvent === 'connected') {
              reconnectDelayRef.current = INITIAL_DELAY;
              reconnectAttemptsRef.current = 0;
            } else if (currentEvent === 'error') {
              console.warn('[SSE] Server error event:', currentData);
            }

            currentEvent = '';
            currentData = '';
          };

          while (!closed) {
            const { done, value } = await reader.read();
            if (done) {
              flushEvent();
              scheduleReconnect();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const rawLine of lines) {
              const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                currentData += (currentData ? '\n' : '') + line.slice(6);
              } else if (line === '') {
                flushEvent();
              }
            }
          }
          if (!closed) {
            scheduleReconnect();
          }
        })
        .catch((err) => {
          if (closed || err.name === 'AbortError') return;
          console.warn('[SSE] Connection error, scheduling reconnect');
          scheduleReconnect();
        });
    }

    void connect();

    return () => {
      closed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [getToken, isReady, queryClient, userId]);
}

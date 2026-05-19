// Shared configuration read from environment at k6 init time.

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001';
export const API_PREFIX = __ENV.API_PREFIX || '/api/v1';

export const BYPASS_TOKEN = __ENV.STRESS_TEST_BYPASS_TOKEN;
if (!BYPASS_TOKEN) {
  throw new Error(
    'STRESS_TEST_BYPASS_TOKEN env var is required. ' +
      'Set the same value in the API process (apps/api/.env or shell) and pass it to k6.',
  );
}

export function url(path) {
  if (path.startsWith('/api/')) return `${BASE_URL}${path}`;
  if (path.startsWith('/')) return `${BASE_URL}${API_PREFIX}${path}`;
  return `${BASE_URL}${API_PREFIX}/${path}`;
}

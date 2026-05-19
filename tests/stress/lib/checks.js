import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// Custom metrics so the summary breaks failures down clearly.
export const errors = new Counter('errors_total');
export const rateLimited = new Counter('rate_limited_total');
export const serverErrors = new Counter('server_errors_total');
export const insufficientCredits = new Counter('insufficient_credits_total');
export const pendingLimitHit = new Counter('pending_limit_total');
export const successRate = new Rate('success_rate');

// Classify the response and bump counters. Returns true if the request
// was "expected" — i.e. 2xx OR a documented backpressure response (429
// from the throttler, 400 for credit/pending-limit ceilings). Anything
// else (5xx, network failure) is a real failure.
export function classify(res, label) {
  const tags = { endpoint: label };
  const status = res.status;
  let expected = false;

  if (status >= 200 && status < 300) {
    expected = true;
  } else if (status === 429) {
    rateLimited.add(1, tags);
    expected = true;
  } else if (status === 400) {
    const body = safeJson(res);
    const message = (body && (body.message || body.error)) || '';
    if (/insufficient credits/i.test(String(message))) {
      insufficientCredits.add(1, tags);
      expected = true;
    } else if (/pending jobs/i.test(String(message)) || /too many pending/i.test(String(message))) {
      pendingLimitHit.add(1, tags);
      expected = true;
    }
  } else if (status >= 500) {
    serverErrors.add(1, tags);
  }

  if (!expected) {
    errors.add(1, tags);
  }

  successRate.add(expected, tags);

  check(res, {
    [`${label}: not a 5xx`]: (r) => r.status < 500,
    [`${label}: not a network error`]: (r) => r.status !== 0,
  });

  return expected;
}

function safeJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

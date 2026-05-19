// Read-heavy scenario — targets the endpoints most likely to expose
// connection-pool exhaustion and N+1 query problems:
//   - GET /me                (simple user lookup baseline)
//   - GET /assets?limit=60   (Asset.findMany + JobAsset includes per row, N+1 risk)
//   - GET /billing/credits   (unbounded CreditLedger.aggregate)
//
// Goal: see whether 100-200 concurrent readers stay under p95 < 1s, or
// whether the Prisma pool (currently configured for connection_limit=2
// on local dev) starts queuing requests.
//
// Run:
//   k6 run tests/stress/scenarios/read-heavy.js
//   k6 run -e VUS=200 -e DURATION=2m tests/stress/scenarios/read-heavy.js

import http from 'k6/http';
import { sleep } from 'k6';
import { url } from '../lib/config.js';
import { userForVU } from '../lib/users.js';
import { stressHeaders } from '../lib/auth.js';
import { classify } from '../lib/checks.js';

const VUS = Number(__ENV.VUS || 150);
const DURATION = __ENV.DURATION || '1m';

export const options = {
  scenarios: {
    read_heavy: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{endpoint:GET /me}': ['p(95)<400'],
    'http_req_duration{endpoint:GET /assets}': ['p(95)<1500'],
    'http_req_duration{endpoint:GET /billing/credits}': ['p(95)<800'],
    success_rate: ['rate>0.95'],
    server_errors_total: ['count<10'],
  },
};

export default function () {
  const user = userForVU(__VU);
  const headers = stressHeaders(user);

  // 60% of traffic on the heavy /assets endpoint — biggest N+1 risk.
  const roll = Math.random();
  if (roll < 0.6) {
    classify(
      http.get(url('/assets?page=1&limit=60'), { headers, tags: { endpoint: 'GET /assets' } }),
      'GET /assets',
    );
  } else if (roll < 0.85) {
    classify(http.get(url('/me'), { headers, tags: { endpoint: 'GET /me' } }), 'GET /me');
  } else {
    classify(
      http.get(url('/billing/credits'), { headers, tags: { endpoint: 'GET /billing/credits' } }),
      'GET /billing/credits',
    );
  }

  // Light pacing — a real user wouldn't hammer back-to-back.
  sleep(Math.random() * 0.5 + 0.2);
}

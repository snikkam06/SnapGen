// Baseline sanity scenario. Confirms auth bypass + happy paths work before
// you ramp to 200 VUs. If this fails, every other scenario will too.
//
// Run: k6 run tests/stress/scenarios/baseline.js

import http from 'k6/http';
import { sleep } from 'k6';
import { url } from '../lib/config.js';
import { userForVU } from '../lib/users.js';
import { stressHeaders } from '../lib/auth.js';
import { classify } from '../lib/checks.js';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    success_rate: ['rate>0.99'],
  },
};

export default function () {
  const user = userForVU(__VU);
  const headers = stressHeaders(user);

  classify(http.get(url('/me'), { headers, tags: { endpoint: 'GET /me' } }), 'GET /me');
  classify(
    http.get(url('/assets?page=1&limit=20'), { headers, tags: { endpoint: 'GET /assets' } }),
    'GET /assets',
  );
  classify(
    http.get(url('/billing/credits'), { headers, tags: { endpoint: 'GET /billing/credits' } }),
    'GET /billing/credits',
  );

  sleep(1);
}

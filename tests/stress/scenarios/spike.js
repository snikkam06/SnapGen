// Spike scenario — ramps from 0 to 200 VUs in 30 seconds, holds for
// 30s, drops back. Simulates a marketing burst or a Twitter post
// driving a sudden flood of traffic. The interesting thing is the
// recovery behavior after the spike subsides.
//
// Run:
//   k6 run tests/stress/scenarios/spike.js
//   k6 run -e PEAK_VUS=300 tests/stress/scenarios/spike.js

import http from 'k6/http';
import { sleep } from 'k6';
import { url } from '../lib/config.js';
import { userForVU } from '../lib/users.js';
import { stressHeaders } from '../lib/auth.js';
import { classify } from '../lib/checks.js';

const PEAK_VUS = Number(__ENV.PEAK_VUS || 200);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: PEAK_VUS },
        { duration: '30s', target: PEAK_VUS },
        { duration: '15s', target: 0 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    success_rate: ['rate>0.85'],
    server_errors_total: ['count<50'],
  },
};

export default function () {
  const user = userForVU(__VU);
  const headers = stressHeaders(user);

  const roll = Math.random();
  if (roll < 0.4) {
    classify(http.get(url('/me'), { headers, tags: { endpoint: 'GET /me' } }), 'GET /me');
  } else if (roll < 0.75) {
    classify(
      http.get(url('/assets?page=1&limit=30'), { headers, tags: { endpoint: 'GET /assets' } }),
      'GET /assets',
    );
  } else {
    const body = JSON.stringify({
      prompt: 'a stress-test spike image',
      mode: 'base',
      settings: { numImages: 1 },
    });
    classify(
      http.post(url('/generations/image'), body, {
        headers,
        tags: { endpoint: 'POST /generations/image' },
      }),
      'POST /generations/image',
    );
  }

  sleep(Math.random() * 0.4 + 0.1);
}

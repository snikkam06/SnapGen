// Mixed-workload scenario — closest approximation of real traffic.
//
// Two parallel executors:
//   - readers:    70% of VUs hitting GET endpoints
//   - generators: 30% of VUs submitting image jobs
//
// Run this when you want a single number for "can the system handle
// 200 concurrent users." If readers and generators interfere via the
// Prisma pool you'll see it here first.
//
// Run:
//   k6 run tests/stress/scenarios/mixed.js
//   k6 run -e TOTAL_VUS=200 -e DURATION=3m tests/stress/scenarios/mixed.js

import http from 'k6/http';
import { sleep } from 'k6';
import { url } from '../lib/config.js';
import { userForVU } from '../lib/users.js';
import { stressHeaders } from '../lib/auth.js';
import { classify } from '../lib/checks.js';

const TOTAL_VUS = Number(__ENV.TOTAL_VUS || 150);
const READER_VUS = Math.round(TOTAL_VUS * 0.7);
const GENERATOR_VUS = TOTAL_VUS - READER_VUS;
const DURATION = __ENV.DURATION || '2m';

const PROMPTS = [
  'a serene mountain lake at sunrise',
  'an astronaut riding a horse on Mars',
  'a futuristic city skyline at dusk',
  'a steampunk workshop full of brass gears',
];

export const options = {
  scenarios: {
    readers: {
      executor: 'ramping-vus',
      exec: 'reader',
      startVUs: 0,
      stages: [
        { duration: '20s', target: READER_VUS },
        { duration: DURATION, target: READER_VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
    generators: {
      executor: 'ramping-vus',
      exec: 'generator',
      startVUs: 0,
      stages: [
        { duration: '20s', target: GENERATOR_VUS },
        { duration: DURATION, target: GENERATOR_VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:GET /me}': ['p(95)<500'],
    'http_req_duration{endpoint:GET /assets}': ['p(95)<2000'],
    'http_req_duration{endpoint:POST /generations/image}': ['p(95)<3000'],
    success_rate: ['rate>0.90'],
    server_errors_total: ['count<30'],
  },
};

export function reader() {
  const user = userForVU(__VU);
  const headers = stressHeaders(user);
  const roll = Math.random();
  if (roll < 0.5) {
    classify(
      http.get(url('/assets?page=1&limit=60'), { headers, tags: { endpoint: 'GET /assets' } }),
      'GET /assets',
    );
  } else if (roll < 0.8) {
    classify(http.get(url('/me'), { headers, tags: { endpoint: 'GET /me' } }), 'GET /me');
  } else {
    classify(
      http.get(url('/billing/credits'), { headers, tags: { endpoint: 'GET /billing/credits' } }),
      'GET /billing/credits',
    );
  }
  sleep(Math.random() * 0.8 + 0.2);
}

export function generator() {
  const user = userForVU(__VU);
  const headers = stressHeaders(user);
  const body = JSON.stringify({
    prompt: PROMPTS[Math.floor(Math.random() * PROMPTS.length)],
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
  // Generators pace slower — even a real power user doesn't queue back-to-back.
  sleep(Math.random() * 2 + 1);
}
